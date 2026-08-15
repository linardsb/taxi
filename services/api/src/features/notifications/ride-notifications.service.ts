import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  formatMessage,
  RT,
  type Ride,
  type RideStatus,
  type SmsProvider,
} from '@taxi/shared';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { maskPhone, SMS_PROVIDER } from '../auth';
import { DRIVER_LOCATION_STORE, type DriverLocationStore } from '../drivers';
import { RealtimeService } from '../realtime';
import type { TransitionedRide } from '../rides';
import { estimateEtaMinutes } from './notifications.policy';
import {
  NotificationsRepository,
  type NotifiableRide,
} from './notifications.repository';
import { driverFirstName, trackingLink } from './sms-templates';

type SmsKind = 'booking_confirmed' | 'driver_assigned' | 'driver_arrived';

/**
 * The rider's SMS story (#63), hanging off two post-commit hooks:
 * `RidesService.createRide` (booking confirmed) and
 * `RideTransitionService.emitStatus` (driver assigned / arrived).
 *
 * Send policy (rider-ux-evidence.md §3.3): confirm + arrival SMS on every
 * channel; the tracking link travels in the confirmation, and the
 * driver-details message goes only to PHONE bookings — an app rider is
 * watching the app. Budget: 2 SMS/ride app channel, 3 phone channel.
 *
 * NEVER THROWS, structurally: both entry points wrap their whole body — an
 * SMS failure never fails a booking. The `sms_send_failed` ERROR log is the
 * durable alarm; `dispatch:sms_failed` (#18) mirrors it onto Dina's console
 * so she can phone the rider the moment the platform fails them.
 */
@Injectable()
export class RideNotificationsService {
  private readonly logger = new Logger(RideNotificationsService.name);

  constructor(
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    private readonly repository: NotificationsRepository,
    @Inject(DRIVER_LOCATION_STORE)
    private readonly locations: DriverLocationStore,
    private readonly realtime: RealtimeService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  /** Post-commit hook #1: the ride row is committed, `trackingToken` is set. */
  async onRideCreated(ride: Ride): Promise<void> {
    try {
      const rider = await this.repository.riderContact(ride.riderId);
      if (!rider) return; // FK makes this unreachable; a missing row must not throw here

      const link = ride.trackingToken
        ? trackingLink(
            this.env.PUBLIC_TRACKING_BASE_URL,
            ride.trackingToken,
            rider.language,
          )
        : null;
      const body =
        ride.bookingChannel === 'phone' && link !== null
          ? formatMessage(rider.language, 'sms.booking_confirmed_phone', {
              link,
            })
          : formatMessage(rider.language, 'sms.booking_confirmed');

      await this.sms.send(rider.phone, body);
      this.logSent(
        ride.id,
        'booking_confirmed',
        ride.bookingChannel,
        rider.phone,
      );
    } catch (error) {
      this.logSendFailed(ride.id, 'booking_confirmed', error);
    }
  }

  /**
   * Post-commit hook #2, fired by `emitStatus` on EVERY transition and
   * filtered here to the two that carry an SMS. Each is reachable at most
   * once per ride (the re-offer loop never passes through either), so there
   * is no dedupe table — see the plan's NOTES on the rejected outbox.
   */
  async onStatus(ride: TransitionedRide, from: RideStatus): Promise<void> {
    if (ride.status !== 'accepted' && ride.status !== 'arrived') return;
    const kind: SmsKind =
      ride.status === 'accepted' ? 'driver_assigned' : 'driver_arrived';

    try {
      const details = await this.repository.rideById(ride.id);
      if (!details || !details.driverId) return;
      // The assigned message is the phone-channel follow-up (the Uber
      // call-to-ride pattern); an app rider sees the same moment in-app.
      if (kind === 'driver_assigned' && details.bookingChannel !== 'phone')
        return;

      const rider = await this.repository.riderContact(ride.riderId);
      if (!rider) return;
      const card = await this.repository.driverCard(
        details.driverId,
        details.vehicleId,
      );
      const plate = card.plate ?? '—';

      const body =
        kind === 'driver_assigned'
          ? formatMessage(rider.language, 'sms.driver_assigned', {
              driver: driverFirstName(card.name),
              plate,
              eta: await this.etaToPickup(details),
              // A legacy row can lack a token, but every phone booking
              // postdates the column — the empty-link branch is theoretical.
              link: details.trackingToken
                ? trackingLink(
                    this.env.PUBLIC_TRACKING_BASE_URL,
                    details.trackingToken,
                    rider.language,
                  )
                : '',
            })
          : formatMessage(rider.language, 'sms.driver_arrived', { plate });

      await this.sms.send(rider.phone, body);
      this.logSent(ride.id, kind, details.bookingChannel, rider.phone);
    } catch (error) {
      this.logSendFailed(ride.id, kind, error, from);
    }
  }

  /** `?` over a fabricated number when the driver has no recorded position. */
  private async etaToPickup(details: NotifiableRide): Promise<number | '?'> {
    if (!details.driverId) return '?';
    const position = await this.locations.positionOf(
      this.env.DEFAULT_CITY_ID,
      details.driverId,
    );
    if (!position) return '?';
    return estimateEtaMinutes(
      position.location,
      details.request.pickup.location,
    );
  }

  private logSent(
    rideId: string,
    kind: SmsKind,
    channel: string,
    phone: string,
  ): void {
    // The metrics ledger's "SMS spend €/week" is derived from THIS event
    // (kind + channel) — rename nothing without updating docs/ux-metrics-ledger.md.
    this.logger.log({
      event: 'ride.notifications.sms_sent',
      rideId,
      kind,
      channel,
      phone: maskPhone(phone),
      at: new Date().toISOString(),
    });
  }

  private logSendFailed(
    rideId: string,
    kind: SmsKind,
    error: unknown,
    from?: RideStatus,
  ): void {
    // ERROR on purpose: this IS the alarm for a rider left without their SMS.
    this.logger.error({
      event: 'ride.notifications.sms_send_failed',
      rideId,
      kind,
      ...(from !== undefined && { previousStatus: from }),
      reason: error instanceof Error ? error.message : 'unknown',
      at: new Date().toISOString(),
    });

    // Mirror the alarm onto the console (#18). Its own try/catch, same as
    // raiseUnclaimed's: a schema drift or gateway hiccup here must not turn a
    // failed SMS into a thrown notification hook.
    try {
      this.realtime.emitToDispatch(
        this.env.DEFAULT_CITY_ID,
        RT.dispatchSmsFailed,
        { rideId, kind, at: new Date().toISOString() },
      );
    } catch (emitError) {
      this.logger.warn({
        event: 'ride.notifications.sms_alert_emit_failed',
        rideId,
        kind,
        reason: emitError instanceof Error ? emitError.message : 'unknown',
        at: new Date().toISOString(),
      });
    }
  }
}
