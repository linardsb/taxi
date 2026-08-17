import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type {
  CallerLookup,
  Customer,
  CustomerUpsertBody,
  SavedPlace,
} from '@taxi/shared';
import { CustomersRepository } from './customers.repository';

export interface VenueEntry {
  customer: Customer;
  places: SavedPlace[];
}

/**
 * The caller-ID path (#19). Its whole job is turning a phone number Dina typed
 * into the record she needs before the caller finishes their first sentence —
 * measured at 15–45 s saved per call (`docs/research/dispatch-ops-ux-evidence.md`).
 */
@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(private readonly repository: CustomersRepository) {}

  /**
   * `null` for a number that has never rung — a first-time caller is the
   * ordinary case, not a 404, and the console renders an empty panel rather
   * than an error.
   *
   * A pure READ: looking someone up must not create their record. Only a
   * booking or an explicit `POST /customers` does that.
   */
  async lookup(
    dispatcherId: string,
    phone: string,
  ): Promise<CallerLookup | null> {
    const user = await this.repository.findUserByPhone(phone);

    // The lookup returns another person's PII, so it is logged as an event with
    // the dispatcher who asked — and NO phone number, per
    // `.claude/references/logging-standard.md`. `found` is what makes the line
    // useful without it.
    this.logger.log({
      event: 'customers.lookup',
      dispatcherId,
      found: user !== undefined,
      at: new Date().toISOString(),
    });

    if (user === undefined) return null;

    const customer = await this.repository.findCustomerByUserId(user.id);
    const [savedPlaces, recentRides] = await Promise.all([
      // A rider who has only ever used the app has no `customers` row, so no
      // saved places either — and their ride history is still the useful half
      // of the pop.
      customer === undefined
        ? Promise.resolve([])
        : this.repository.listSavedPlaces(customer.id),
      this.repository.findRecentRides(user.id),
    ]);
    return {
      userId: user.id,
      customer: customer ?? null,
      savedPlaces,
      recentRides,
    };
  }

  listVenues(): Promise<VenueEntry[]> {
    return this.repository.listVenues();
  }

  /**
   * Dina naming a caller or flagging a venue. Creates the `users` row if the
   * number has never rung — she is allowed to file a venue before it calls.
   *
   * Refuses a phone that belongs to a driver or a dispatcher: a customer record
   * on a driver's number would make the caller pop offer to book that driver a
   * ride as themselves.
   */
  async upsert(body: CustomerUpsertBody): Promise<Customer> {
    const existing = await this.repository.findUserByPhone(body.phone);
    if (existing !== undefined && existing.role !== 'rider') {
      throw new BadRequestException('phone_belongs_to_staff');
    }

    const user =
      existing ??
      (await this.repository.findOrCreateUser(body.phone, undefined));
    const customer = await this.repository.findOrCreateCustomer(user.id);
    const updated = await this.repository.updateCustomer(customer.id, {
      label: body.label,
      isVenue: body.isVenue,
      notes: body.notes,
    });
    if (updated === undefined) {
      throw new Error('customers.upsert lost the row it just created');
    }
    return updated;
  }
}
