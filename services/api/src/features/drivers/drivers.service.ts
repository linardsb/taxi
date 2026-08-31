import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  formatMessage,
  type DriverMe,
  type DriverPresenceStatus,
  type DriverProfile,
  type DriverProfileUpdate,
  type PushProvider,
} from '@taxi/shared';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import type { DbTx } from '../../common/db/db.module';
import { PUSH_PROVIDER } from '../push';
import {
  DriversRepository,
  type DriverBoardContact,
  type DriverRosterContact,
  type DriverMatchAttributes,
} from './drivers.repository';
import {
  NUDGE_BATCH_LIMIT,
  OFFLINE_NUDGE_DELAY_SECONDS,
  PRESENCE_DARK_AFTER_SECONDS,
} from './location/driver-location.policy';
import {
  DRIVER_LOCATION_STORE,
  type DriverLocationStore,
} from './location/driver-location.store';
import { DriverPresenceRepository } from './presence/driver-presence.repository';
import { VehiclesRepository } from './vehicles.repository';

/** Why the SERVER took a driver offline — never the driver's own toggle. */
export type ServerOfflineReason = 'socket_disconnected' | 'dark';

@Injectable()
export class DriversService {
  private readonly logger = new Logger(DriversService.name);

  constructor(
    private readonly drivers: DriversRepository,
    private readonly vehicles: VehiclesRepository,
    private readonly presence: DriverPresenceRepository,
    @Inject(DRIVER_LOCATION_STORE)
    private readonly locations: DriverLocationStore,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  /**
   * The driver app's whole bootstrap. The FIRST call provisions the `drivers`
   * row; every later one only reads it.
   *
   * Read-then-provision rather than a straight `findOrCreate` (L5): the latter
   * is an UPDATE even when nothing changes, so this call — which runs on every
   * app open — left a dead tuple behind each time. Still race-safe, because the
   * fallback is the same atomic upsert: two concurrent first calls both miss
   * the SELECT and both land on `findOrCreate`, which is built for exactly that.
   */
  async getMe(userId: string): Promise<DriverMe> {
    const profile =
      (await this.drivers.find(userId)) ??
      (await this.drivers.findOrCreate(userId));
    return { profile, vehicles: await this.vehicles.listForDriver(userId) };
  }

  /**
   * `findOrCreate` first, like every other write path in this slice: a driver
   * whose first call is PATCH has no row yet, and the bare UPDATE would match
   * nothing and 500 on a perfectly valid request.
   */
  async updateProfile(
    userId: string,
    patch: DriverProfileUpdate,
  ): Promise<DriverProfile> {
    await this.drivers.findOrCreate(userId);
    return this.drivers.updateProfile(userId, patch);
  }

  /**
   * The two stores are written in OPPOSITE orders on purpose, so that both
   * halves fail toward *not dispatchable*:
   *
   * Going online, Postgres commits first. A Redis failure after it leaves a
   * driver who believes they are online but receives nothing — visible to them,
   * and self-healing on the next toggle.
   *
   * Going offline, Redis is cleared first. A Postgres failure after it leaves a
   * driver who is already undispatchable while the durable record catches up.
   *
   * Either order reversed would hand rides to a driver who is not there.
   */
  async setPresence(
    userId: string,
    status: DriverPresenceStatus,
  ): Promise<DriverProfile> {
    // A driver may toggle before ever GETting /me.
    const profile = await this.drivers.findOrCreate(userId);

    // #11 owns entering and leaving `on_ride`; a driver must not step out of
    // it by hand and take a second offer — so `offline` is refused. An
    // `online` re-assert while held (a socket reconnect or foreground refetch
    // mid-ride) is the app repeating what the server already holds: answer
    // with the profile and touch nothing — a 409 here made the app flip its
    // toggle and tear the stream down mid-ride, losing the tracking page's
    // feed (review F3). Cheap first gate only: chain A's driver (#61) is
    // `offline` with a live ride, which is what the rides-table check inside
    // `setOnlineIfEligible` catches below.
    if (profile.status === 'on_ride') {
      if (status === 'offline') throw new ConflictException('driver_on_ride');
      return profile;
    }

    const cityId = this.env.DEFAULT_CITY_ID;
    let updated: DriverProfile;

    if (status === 'online') {
      // `auto_match` filters on `category` and `hasChildSeat`, both vehicle
      // attributes — an online driver with no vehicle is a candidate #10 can
      // only ever discard.
      //
      // The vehicle check is INSIDE the update (L8). Counting first and setting
      // after left a window for a concurrent delete of the last vehicle to slip
      // between them, which is how a driver ended up online with no car.
      const online = await this.drivers.setOnlineIfEligible(userId);
      if (!online) {
        // The UPDATE said no; this read only picks the message. #61 chain A: an
        // active ride outranks a missing vehicle — that driver is mid-ride, and
        // `vehicle_required` would send them to the garage instead of the ride.
        throw new ConflictException(
          (await this.drivers.hasActiveRide(userId))
            ? 'driver_on_ride'
            : 'vehicle_required',
        );
      }
      updated = online;
      await this.locations.markOnline(cityId, userId, Date.now());
    } else {
      await this.locations.markOffline(cityId, userId);
      updated = await this.drivers.setStatus(userId, 'offline');
    }

    this.logger.log({
      event: 'driver.presence.status_changed',
      driverId: userId,
      from: profile.status,
      to: updated.status,
      at: new Date().toISOString(),
    });
    return updated;
  }

  /**
   * The SERVER taking a driver offline — the two paths that are not a toggle.
   * `socket_disconnected` is the last socket going away (#38): before it, a
   * force-quit left them `online` in Postgres and in all three
   * `drivers:*:<city>` keys forever. `dark` is #14's: the socket is up but
   * there has been no proof of life — an accepted fix or a `PUT status online`
   * re-assert — for `PRESENCE_DARK_AFTER_SECONDS`: permission revoked,
   * location services off, the task crashed.
   *
   * Both stamp `offline_nudge_due_at = now + OFFLINE_NUDGE_DELAY_SECONDS`, and
   * the sweeper sends ONE push when it comes due unless the driver is back
   * online by then (`setOnlineIfEligible` nulls the column). State is a row,
   * never a timer. A voluntary offline stamps nothing.
   *
   * Same Redis-then-Postgres order as `setPresence`'s offline branch, and for
   * the same reason — a failure between the two must leave the driver
   * undispatchable, never the reverse. Returns false when nothing happened.
   */
  async markOfflineByServer(
    userId: string,
    reason: ServerOfflineReason,
    nowMs = Date.now(),
  ): Promise<boolean> {
    const cityId = this.env.DEFAULT_CITY_ID;
    const status = (await this.drivers.find(userId))?.status;

    // Only `online` is this path's to clear. `on_ride` belongs to #11 — a
    // driver whose app crashes mid-ride must not be dropped off the ride by a
    // lost socket, and their position still feeds the tracking page — so
    // their presence is left alone. A row that says `offline` is already
    // where this would land in Postgres, but not necessarily in Redis: such a
    // member (a Postgres write that failed after the Redis one, a deploy
    // ghost) is a driver on the board every tick, so it is dropped. No row
    // at all is left alone — nothing to reconcile against, and no production
    // path puts a rowless driver in the set (every online path provisions
    // the row first); the gateway spec's store-only drivers rely on it.
    if (status === 'offline') {
      await this.locations.markOffline(cityId, userId);
      return false;
    }
    if (status !== 'online') return false;

    await this.locations.markOffline(cityId, userId);
    const marked = await this.presence.markOfflineByServer(
      userId,
      new Date(nowMs + OFFLINE_NUDGE_DELAY_SECONDS * 1000),
    );
    if (!marked) {
      // The read said `online`; the conditional UPDATE found otherwise. A
      // claim (`on_ride`) or a toggle landed between the two, and Redis
      // presence is already dropped. For a toggle that is where it belongs;
      // for a claim it would strand the ride's position feed — nothing else
      // re-adds it (`setPresence` is 409 on `on_ride`, `releaseFromRide`
      // never touches Redis) — so it is put back.
      const now = (await this.drivers.find(userId))?.status;
      const presenceRestored = now === 'on_ride';
      if (presenceRestored) {
        await this.locations.markOnline(cityId, userId, nowMs);
      }
      this.logger.warn({
        event: 'driver.presence.offline_skipped',
        driverId: userId,
        reason,
        status: now ?? 'missing',
        presenceRestored,
        at: new Date().toISOString(),
      });
      return false;
    }

    this.logger.log({
      event: 'driver.presence.status_changed',
      driverId: userId,
      from: 'online',
      to: 'offline',
      reason,
      at: new Date().toISOString(),
    });
    return true;
  }

  /**
   * The dark sweep (#14): every member of the online set whose last proof of
   * life is older than the freshness window goes offline. A null `lastSeenMs`
   * — a member that predates the seeded score — is unknown, and unknown is
   * dark. `on_ride` members fall out inside `markOfflineByServer`.
   */
  async markDarkDrivers(nowMs: number): Promise<number> {
    const online = await this.locations.listOnline(this.env.DEFAULT_CITY_ID);
    const cutoffMs = nowMs - PRESENCE_DARK_AFTER_SECONDS * 1000;
    let marked = 0;
    for (const driver of online) {
      if (driver.lastSeenMs !== null && driver.lastSeenMs >= cutoffMs) continue;
      if (await this.markOfflineByServer(driver.driverId, 'dark', nowMs)) {
        marked += 1;
      }
    }
    return marked;
  }

  /**
   * The nudge pass (#14). `claimNudge` — a conditional UPDATE nulling the
   * column — is the send lock, so two nodes cannot both push. Best-effort by
   * design: a provider error is logged and the row stays claimed; the driver
   * is offline and Dina's board says so.
   */
  async sendDueNudges(now: Date): Promise<void> {
    const due = await this.presence.findDueNudges(now, NUDGE_BATCH_LIMIT);
    for (const row of due) {
      const at = new Date().toISOString();
      if (!(await this.presence.claimNudge(row.userId))) {
        // The column was nulled between the read and the claim: the driver
        // came back online (or, on a second node, someone else sent it).
        this.logger.log({
          event: 'driver.push.nudge_skipped',
          driverId: row.userId,
          reason: 'back_online',
          at,
        });
        continue;
      }
      if (!row.pushToken) {
        this.logger.log({
          event: 'driver.push.nudge_skipped',
          driverId: row.userId,
          reason: 'no_token',
          at,
        });
        continue;
      }
      const result = await this.push.send(row.pushToken, {
        title: formatMessage(row.language, 'push.offline_nudge_title'),
        body: formatMessage(row.language, 'push.offline_nudge_body'),
        data: { kind: 'offline_nudge' },
      });
      if (result.ok) {
        this.logger.log({
          event: 'driver.push.nudge_sent',
          driverId: row.userId,
          language: row.language,
          at,
        });
        continue;
      }
      if (result.reason === 'device_not_registered') {
        await this.presence.setPushToken(row.userId, null);
      }
      this.logger.warn({
        event: 'driver.push.nudge_failed',
        driverId: row.userId,
        reason: result.reason,
        at,
      });
    }
  }

  /**
   * The phone's Expo push token (#14) — `findOrCreate` first, like every other
   * write path here: registering the token may be a driver's very first call.
   * The token itself is never logged; it is a device handle.
   */
  async setPushToken(userId: string, token: string): Promise<void> {
    await this.drivers.findOrCreate(userId);
    await this.presence.setPushToken(userId, token);
    this.logger.log({
      event: 'driver.push.token_registered',
      driverId: userId,
      at: new Date().toISOString(),
    });
  }

  /** On sign-out — a phone handed to another driver must not carry the old driver's nudges. */
  async clearPushToken(userId: string): Promise<void> {
    await this.drivers.findOrCreate(userId);
    await this.presence.setPushToken(userId, null);
    this.logger.log({
      event: 'driver.push.token_cleared',
      driverId: userId,
      at: new Date().toISOString(),
    });
  }

  /**
   * `on_ride` claim and release — the ONLY two writers of that status, both
   * reached through #11's lifecycle (`services/api/CLAUDE.md`). Without the
   * claim, `candidate-filter.ts` still sees an accepted driver as `online` and
   * the very next sweeper tick offers them a second car.
   *
   * `false` means the conditional UPDATE matched nothing, which is ordinary —
   * see `DriversRepository.claimForRide`. Neither method throws.
   *
   * Both run INSIDE the caller's transaction, so the log line is deliberately
   * modest: it records that the statement matched, not that the ride moved.
   * The caller's post-commit `ride.lifecycle.transition_applied` is the
   * authoritative record, and a rollback would make anything stronger a lie.
   */
  async claimForRide(driverId: string, tx?: DbTx): Promise<boolean> {
    const claimed = await this.drivers.claimForRide(driverId, tx);
    if (claimed) {
      this.logger.log({
        event: 'driver.presence.claimed_for_ride',
        driverId,
        from: 'online',
        to: 'on_ride',
        at: new Date().toISOString(),
      });
    }
    return claimed;
  }

  async releaseFromRide(driverId: string, tx?: DbTx): Promise<boolean> {
    const released = await this.drivers.releaseFromRide(driverId, tx);
    if (released) {
      this.logger.log({
        event: 'driver.presence.released_from_ride',
        driverId,
        from: 'on_ride',
        to: 'online',
        at: new Date().toISOString(),
      });
    }
    return released;
  }

  /** #10's entry point: the attributes it filters a proximity list by. */
  findMatchAttributes(driverIds: string[]): Promise<DriverMatchAttributes[]> {
    return this.drivers.findMatchAttributes(driverIds);
  }

  /** #18's entry point: who the online set IS — name, phone, status. */
  findBoardContacts(driverIds: string[]): Promise<DriverBoardContact[]> {
    return this.drivers.findBoardContacts(driverIds);
  }

  /** #19's entry point: EVERY driver, offline ones included — the override picker. */
  findRosterContacts(limit: number): Promise<DriverRosterContact[]> {
    return this.drivers.findRosterContacts(limit);
  }
}
