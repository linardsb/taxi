import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { APP_ENV, type Env } from '../../../common/config/env.schema';
import { DriversService } from '../drivers.service';
import { PRESENCE_SWEEP_INTERVAL_MS } from '../location/driver-location.policy';

/**
 * Dark detection + the offline nudge (#14), mirroring `DispatchSweeper`: a
 * background process, every piece of state a ROW (`drivers.offline_nudge_due_at`)
 * rather than a timer, so a restart strands nothing and `tick(nowMs)` is
 * awaitable from a spec with no sleeping and no fake clock.
 *
 * Two passes, in this order: mark dark first, so a driver who went dark just
 * over 30 s ago is nudged on the same tick the delay allows.
 */
@Injectable()
export class DriverPresenceSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DriverPresenceSweeper.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly drivers: DriversService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  /**
   * The interval does NOT start under `NODE_ENV=test` — the harness boots the
   * real `AppModule`, and an auto-started sweeper would knock every
   * integration suite's drivers offline behind its back. Specs drive `tick()`.
   */
  onModuleInit(): void {
    if (this.env.NODE_ENV === 'test') return;

    this.timer = setInterval(
      () => void this.tick(),
      PRESENCE_SWEEP_INTERVAL_MS,
    );
    // Never hold the process open on its own account.
    this.timer.unref();
  }

  /** Without this jest hangs after the suite and CI times out rather than fails. */
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One pass over the world. Each phase is wrapped so one failure cannot kill the loop. */
  async tick(nowMs = Date.now()): Promise<void> {
    // A tick still in flight skips rather than overlapping: two concurrent
    // passes would both read the same due row and race to claim it.
    if (this.running) return;
    this.running = true;

    try {
      await this.runPass('mark_dark', () =>
        this.drivers.markDarkDrivers(nowMs),
      );
      await this.runPass('send_nudges', () =>
        this.drivers.sendDueNudges(new Date(nowMs)),
      );
    } finally {
      this.running = false;
    }
  }

  private async runPass(
    pass: string,
    run: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.logger.error({
        event: 'driver.presence.sweep_pass_failed',
        pass,
        reason: error instanceof Error ? error.message : 'unknown',
        at: new Date().toISOString(),
      });
    }
  }
}
