import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { DispatcherBookingBody, RideCreated } from '@taxi/shared';
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

    // A driver's or a dispatcher's own number must not become a rider identity:
    // the booking would turn a working driver into their own passenger, and
    // every eligibility read on that user would then answer for the wrong role.
    const existing = await this.customers.findUserByPhone(callerPhone);
    if (existing !== undefined && existing.role !== 'rider') {
      throw new BadRequestException('phone_belongs_to_staff');
    }

    const user =
      existing ??
      (await this.customers.findOrCreateUser(callerPhone, callerName));
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
          ...(dispatcherNote === null ? {} : { note: dispatcherNote }),
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
