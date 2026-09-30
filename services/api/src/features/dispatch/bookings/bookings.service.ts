import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  displayNameSchema,
  type DispatcherBookingBody,
  type RideCreated,
  type UserRole,
} from '@taxi/shared';
import { CustomersRepository } from '../../customers';
import { RidesService } from '../../rides';
import { DispatchRepository } from '../dispatch.repository';

function assertRiderPhone(user: { role: UserRole } | undefined): void {
  if (user !== undefined && user.role !== 'rider') {
    throw new BadRequestException('phone_belongs_to_staff');
  }
}

/**
 * The phone channel's booking path (#19).
 *
 * Its whole job is to put an IDENTITY RESOLUTION step into
 * `RidesService.requestForCaller()` and change nothing else. The quote, the idempotency
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
    // A pure read, so a 400 here reserves nothing and charges no quota.
    const existing = await this.customers.findUserByPhone(callerPhone);
    assertRiderPhone(existing);

    // Identity is resolved INSIDE the booking, after the reservation, the cap
    // and the quote (#123): a booking any of them refuses mints no `users` or
    // `customers` row. The reservation is keyed on the phone for that reason.
    const created = await this.rides.requestForCaller(
      {
        phone: callerPhone,
        resolveRiderId: () =>
          this.resolveCaller(dispatcherId, callerPhone, callerName),
      },
      idempotencyKey,
      rideBody,
      // The cap counts against the DISPATCHER on this path — see the
      // `rateLimitSubject` docblock in `RidesService.request` for why the rider
      // key is the wrong one here.
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
      riderId: created.ride.riderId,
      newCaller: existing === undefined,
      at: new Date().toISOString(),
    });

    return created;
  }

  /**
   * Find or mint the caller's `users` row — minted as PROVISIONAL, filed by
   * this dispatcher (#123), so the person's own OTP signup adopts it — then
   * their name and customer record. Runs only once the booking has cleared
   * every refusal (see `RidesService.requestForCaller`).
   */
  private async resolveCaller(
    dispatcherId: string,
    callerPhone: string,
    callerName: string | undefined,
  ): Promise<string> {
    const user = await this.customers.findOrCreateUser(
      callerPhone,
      dispatcherId,
    );
    // Again, on the row actually resolved: the read above ran before the
    // reservation and the quote, and the number may have become a driver's in
    // between (an OTP signup adopting a provisional row, #123).
    assertRiderPhone(user);
    // Dina's name for the caller fills an EMPTY name only (#269 D2), and an
    // unusable one (blank, control characters) is "no name", never a 400 — a
    // failed submit mid-call costs the caller (D4). Before the ride insert, so
    // the name is stored before any driver can accept.
    const name = displayNameSchema.safeParse(callerName);
    if (name.success) {
      await this.customers.fillEmptyDisplayName(user.id, name.data);
    }
    // Filed at booking time so the NEXT call from this number pops a record.
    // Never overwrites a label Dina already typed — `findOrCreateCustomer`'s
    // conflict clause is a no-op update.
    await this.customers.findOrCreateCustomer(user.id);
    return user.id;
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
