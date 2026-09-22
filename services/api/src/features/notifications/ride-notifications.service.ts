import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  formatMessage,
  RT,
  type Ride,
  type RideStatus,
  SMS_ETA_MAX_DISPLAY_MINUTES,
  type SmsKind,
  type SmsProvider,
  smsSegments,
  trackingLink,
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
import { smsDriverName } from './sms-templates';

/**
 * The rider's SMS story (#63), hanging off two post-commit hooks:
 * `RidesService.createRide` (booking confirmed) and
 * `RideTransitionService.emitStatus` (driver assigned / arrived).
 *
 * Send policy (rider-ux-evidence.md §3.3, amended by #135): the confirmation
 * goes to every channel and carries the tracking link; the driver-details AND
 * arrival messages go only to PHONE bookings (#63) — an app rider sees both
 * moments in-app. Budget: 1 SMS/ride app channel, 3 phone channel.
 *
 * NEVER THROWS, structurally: both entry points wrap their whole body — an
 * SMS failure never fails a booking. The `sms_send_failed` ERROR log is the
 * durable alarm; `dispatch:sms_failed` (#18) mirrors it onto Dina's console
 * so she can phone the rider the moment the platform fails them.
 *
 * Every body leaves through `sendSms`, which counts its billed segments. The
 * two LINKED templates are budgeted to fit ONE UCS-2 segment at the maximum
 * of every bound (#136) — the derivation lives in `@taxi/shared`'s
 * `tracking-link.ts`, the proof in `packages/shared/tests/sms-budget.test.ts`.
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

      await this.sendSms(
        ride.id,
        'booking_confirmed',
        ride.bookingChannel,
        rider.phone,
        body,
      );
    } catch (error) {
      this.logSendFailed(ride.id, 'booking_confirmed', error);
    }
  }

  /**
   * Post-commit hook #2, fired by `emitStatus` on EVERY transition and
   * filtered here to the two that carry an SMS.
   *
   * `accepted` is reachable MORE THAN ONCE per ride since #19 added the
   * dispatcher release (`accepted|arriving → requested`): a reassign walks the
   * ride back into the cascade and a second driver accepts it. That repeat is
   * intended — each `driver_assigned` names the ride's CURRENT driver, plate
   * and ETA, so the second message is a correction rather than a duplicate,
   * and it is the only way the rider learns their car changed.
   *
   * Still no dedupe table, but NOT because the statuses fire once: `emitStatus`
   * runs once per APPLIED transition, race-guarded by the conditional UPDATE,
   * so a duplicate SMS would mean a duplicate assignment. See the plan's NOTES
   * on the rejected outbox.
   */
  async onStatus(ride: TransitionedRide, from: RideStatus): Promise<void> {
    if (ride.status !== 'accepted' && ride.status !== 'arrived') return;
    const kind: SmsKind =
      ride.status === 'accepted' ? 'driver_assigned' : 'driver_arrived';

    try {
      const details = await this.repository.rideById(ride.id);
      if (!details || !details.driverId) return;
      // An app rider sees both moments in-app, so neither message is theirs
      // (#135, SMS volume lever 1). Phone bookings (#63) keep everything —
      // SMS is their only channel. `=== 'app'` rather than `!== 'phone'`:
      // a channel we cannot vouch for gets the SMS (fail open), which is
      // also the AC's "channel unknown → send".
      if (details.bookingChannel === 'app') return;

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
              driver: smsDriverName(card.name),
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

      await this.sendSms(
        ride.id,
        kind,
        details.bookingChannel,
        rider.phone,
        body,
      );
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
    // DISPLAY-only clamp, one of #136's four bounds. The value is already an
    // estimate, and a >99-minute pickup ETA means dispatch assigned a driver
    // ~41 km away — a bug the rider's SMS should not spend a second billed
    // segment reporting to three digits.
    return Math.min(
      SMS_ETA_MAX_DISPLAY_MINUTES,
      estimateEtaMinutes(position.location, details.request.pickup.location),
    );
  }

  /**
   * The single exit for every rider SMS: count, assert, send, log.
   *
   * The `sms_multi_segment` warn is an ASSERTION, not a budget backstop. With
   * `smsDriverName`, the ETA clamp, `vehicleSchema.plate`'s `.max(10)` and the
   * `PUBLIC_TRACKING_BASE_URL` host gate at boot, no input can push a linked
   * template past one segment — so this firing in production means the
   * derivation in `tracking-link.ts` is wrong, which is what makes it worth an
   * alarm. It never gates the send: the rider gets their message either way.
   *
   * THAT GUARANTEE IS PRODUCTION-ONLY, and the condition is not a technicality
   * (PR #245 F5). Three of the four bounds hold everywhere, but the host gate
   * is enforced only under `NODE_ENV === 'production'`; dev and CI default to
   * `http://localhost:3000`, a 14-character host — four OVER the ceiling the
   * derivation solves for.
   *
   * `observed` at that host, rendered through the built `dist`, every other
   * term at its bound: LV `driver_assigned` 73 characters / 2 segments, RU 74
   * / 2, EN 72 / 1 (GSM-7, so it has 160 septets, not 70 code units). And it
   * needs no pathology to get there — a driver called *Aleksandrs* (10) in
   * plate `LV-12345` (8) at a 5-minute ETA already renders RU at 71 / 2.
   *
   * So LOCALLY this warn is a backstop and reaching it says nothing about the
   * derivation; only in production is it the alarm described above.
   * `ride-notifications.service.spec.ts` pins the production case by
   * overriding the host to the enforced ceiling, because this file's default
   * cannot.
   */
  private async sendSms(
    rideId: string,
    kind: SmsKind,
    channel: string,
    phone: string,
    body: string,
  ): Promise<void> {
    const segments = smsSegments(body);
    if (segments > 1) {
      // NEVER the body: it carries the rider's tracking link and the driver's
      // name (logging-standard.md).
      this.logger.warn({
        event: 'ride.notifications.sms_multi_segment',
        rideId,
        kind,
        segments,
        at: new Date().toISOString(),
      });
    }

    await this.sms.send(phone, body);
    this.logSent(rideId, kind, channel, phone);
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
