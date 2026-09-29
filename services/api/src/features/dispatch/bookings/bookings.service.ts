import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  displayNameSchema,
  type DispatcherBookingBody,
  type RideCreated,
} from '@taxi/shared';
import { CustomersRepository } from '../../customers';
import { RidesService } from '../../rides';
import { DispatchRepository } from '../dispatch.repository';

/**
 * The phone channel's booking path (#19).
 *
 * Its whole job is to put an IDENTITY RESOLUTION step in front of
 * `RidesService.request()` and change nothing else. The quote, the idempotency
 * reservation, the rate limit, the tracking token, the SMS and the cascade all
 * come from that one call — a phone order is a normal ride whose
 * `bookingChannel` is `'phone'`, and the AC that says it "flows through normal
 * dispatch" is satisfied by reuse rather than by parallel code that resembles
 * it.
 */
@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly rides: RidesService,
    private readonly customers: CustomersRepository,
    private readonly dispatch: DispatchRepository,
  ) {}

  async book(
    dispatcherId: string,
    idempotencyKey: string,
    body: DispatcherBookingBody,
  ): Promise<RideCreated> {
    const { callerPhone, callerName, dispatcherNote, ...rideBody } = body;
    // Blank is "no note" (#303 D4): the console sends whitespace as typed, and
    // the driver would get an empty box.
    const note = dispatcherNote?.trim() ? dispatcherNote.trim() : null;

    // A driver's or a dispatcher's own number must not become a rider identity:
    // the booking would turn a working driver into their own passenger, and
    // every eligibility read on that user would then answer for the wrong role.
    const existing = await this.customers.findUserByPhone(callerPhone);
    if (existing !== undefined && existing.role !== 'rider') {
      throw new BadRequestException('phone_belongs_to_staff');
    }

    const user =
      existing ?? (await this.customers.findOrCreateUser(callerPhone));
    // Dina's name for the caller fills an EMPTY name only (#269 D2), and an
    // unusable one (blank, control characters) is "no name", never a 400 — a
    // failed submit mid-call costs the caller (D4). Before `rides.request`, so
    // the name is stored before any driver can accept.
    const name = displayNameSchema.safeParse(callerName);
    if (name.success) {
      await this.customers.fillEmptyDisplayName(user.id, name.data);
    }
    // Filed at booking time so the NEXT call from this number pops a record.
    // Never overwrites a label Dina already typed — `findOrCreateCustomer`'s
    // conflict clause is a no-op update.
    await this.customers.findOrCreateCustomer(user.id);

    const created = await this.rides.request(
      user.id,
      idempotencyKey,
      rideBody,
      'phone',
      // The cap counts against the DISPATCHER on this path — see the parameter's
      // docblock in `RidesService.request` for why the rider key is the wrong
      // one here.
      dispatcherId,
      // In the ride's own insert (#303), so it survives the audit failure below.
      note,
    );

    // AFTER the ride exists, and deliberately not inside its transaction: the
    // ride is committed and a failure here must not undo a car already being
    // dispatched. The row is the S9-2 trail for "who booked on whose behalf" —
    // the assignment row that follows is written by the cascade.
    await this.dispatch
      .insertBookingAudit({
        rideId: created.ride.id,
        dispatcherId,
        payload: {
          ...(note === null ? {} : { note }),
        },
      })
      .catch((error: unknown) => this.auditFailed(created.ride.id, error));

    // No phone number and no address: the ride id is the join key for anything
    // that needs them (`.claude/references/logging-standard.md`).
    this.logger.log({
      event: 'dispatch.booking.created',
      rideId: created.ride.id,
      dispatcherId,
      riderId: user.id,
      newCaller: existing === undefined,
      at: new Date().toISOString(),
    });

    return created;
  }

  /**
   * NOT silent, and NOT fatal. An unauditable booking is a real defect — the
   * whole S9-2 argument is that an override without an actor is unauditable —
   * but the ride is committed and the caller has a car coming, so the honest
   * response is a loud log rather than a 500 the dispatcher would retry into a
   * second ride.
   */
  private auditFailed(rideId: string, error: unknown): void {
    this.logger.error({
      event: 'dispatch.booking.audit_failed',
      rideId,
      errorName: error instanceof Error ? error.name : 'unknown',
      at: new Date().toISOString(),
    });
  }
}
