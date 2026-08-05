import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { PlatformConfigService } from '../platform-config';
import { RidesRepository, type AwaitingRide } from '../rides';
import { DispatchRepository } from './dispatch.repository';
import {
  AWAITING_BATCH_LIMIT,
  MAX_OFFER_ATTEMPTS,
  SWEEP_INTERVAL_MS,
} from './dispatch.policy';
import { DispatchService } from './dispatch.service';

/**
 * Dispatch is a BACKGROUND PROCESS, not a request handler: nobody is waiting on
 * an HTTP connection while a cascade runs, and a cascade takes
 * `offerTimeoutSeconds` per candidate across several candidates.
 *
 * Every piece of cascade state is a ROW — a `ride_offers` row with an
 * `expires_at` — never a `setTimeout` that dies with the process. That is what
 * makes this restart-safe, and it is also what makes it testable: `tick()` is
 * public and awaitable, so a cascade test advances the world with no sleeping
 * and no fake clock. An offer seeded with a past `expires_at` is expired by
 * Postgres's own `now()`.
 */
@Injectable()
export class DispatchSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DispatchSweeper.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly dispatch: DispatchService,
    private readonly offers: DispatchRepository,
    private readonly rides: RidesRepository,
    private readonly config: PlatformConfigService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  /**
   * The interval does NOT start under `NODE_ENV=test`.
   *
   * `test/harness.ts` boots the real `AppModule`, so an auto-started sweeper
   * would run inside every integration suite — finding the rides
   * `rides.integration.spec.ts` creates, stamping their geozone, and racing the
   * `tick()` a dispatch test calls by hand for the candidate it was about to
   * assert on. Specs drive `tick()` themselves; this mirrors how
   * `StubMapsProvider` and the env-secret checks already branch on the
   * environment rather than pretending there is only one.
   */
  onModuleInit(): void {
    if (this.env.NODE_ENV === 'test') return;

    this.timer = setInterval(() => void this.tick(), SWEEP_INTERVAL_MS);
    // Never hold the process open on its own account.
    this.timer.unref();
  }

  /** Without this jest hangs after the suite and CI times out rather than fails. */
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * One pass over the world. Each phase is wrapped so a single failure — a
   * Postgres blip, a bad row — cannot kill the loop and strand every ride.
   */
  async tick(): Promise<void> {
    // A tick still in flight skips rather than overlapping: two concurrent
    // passes would both read the same awaiting ride and race to offer it.
    if (this.running) return;
    this.running = true;

    try {
      await this.runPass('expire_overdue', () => this.expireOverdueOffers());
      await this.runPass('dispatch_awaiting', () =>
        this.dispatchAwaitingRides(),
      );
      await this.runPass('alert_unclaimed', () => this.alertUnclaimed());
    } finally {
      this.running = false;
    }
  }

  private async runPass(pass: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.logger.error({
        event: 'dispatch.sweep.pass_failed',
        pass,
        reason: error instanceof Error ? error.message : 'unknown',
        at: new Date().toISOString(),
      });
    }
  }

  /** Pending offers past their deadline → expired, card cleared, ride re-offered. */
  private async expireOverdueOffers(): Promise<void> {
    const overdue = await this.offers.findOverdue(AWAITING_BATCH_LIMIT);
    for (const offer of overdue) {
      await this.dispatch.expireOffer(offer);
    }
  }

  /** `requested` rides with nobody holding an offer → offer the best candidate. */
  private async dispatchAwaitingRides(): Promise<void> {
    const awaiting =
      await this.rides.findAwaitingDispatch(AWAITING_BATCH_LIMIT);
    for (const ride of awaiting) {
      const pending = await this.offers.findPendingForRide(ride.id);
      if (pending) continue; // a live offer is already out on this ride
      await this.dispatch.offerNext(ride);
    }
  }

  /**
   * Rides that have sat too long, or exhausted the cascade → Dina (S9-4).
   * `DispatchService.raiseUnclaimed` owns the dedupe, so this may re-select the
   * same ride every tick without re-alerting.
   */
  private async alertUnclaimed(): Promise<void> {
    const config = await this.config.forCity(this.env.DEFAULT_CITY_ID);
    const awaiting =
      await this.rides.findAwaitingDispatch(AWAITING_BATCH_LIMIT);
    const now = Date.now();

    for (const ride of awaiting) {
      const attempts = await this.offers.countAttempts(ride.id);
      if (!this.isStale(ride, attempts, config.unclaimedAlertSeconds, now)) {
        continue;
      }
      await this.dispatch.raiseUnclaimed(ride, attempts);
    }
  }

  private isStale(
    ride: AwaitingRide,
    attempts: number,
    thresholdSeconds: number,
    nowMs: number,
  ): boolean {
    const waitedSeconds = (nowMs - ride.createdAt.getTime()) / 1000;
    return waitedSeconds >= thresholdSeconds || attempts >= MAX_OFFER_ATTEMPTS;
  }
}
