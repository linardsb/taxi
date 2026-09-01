import { Logger } from '@nestjs/common';
import type { Env } from '../../../common/config/env.schema';
import type { DriversService } from '../drivers.service';
import { PRESENCE_SWEEP_INTERVAL_MS } from '../location/driver-location.policy';
import { DriverPresenceSweeper } from './driver-presence.sweeper';

const env = (NODE_ENV: Env['NODE_ENV']) => ({ NODE_ENV }) as Env;

function build(
  over: Partial<{ markDarkDrivers: jest.Mock; sendDueNudges: jest.Mock }> = {},
  nodeEnv: Env['NODE_ENV'] = 'test',
) {
  const markDarkDrivers =
    over.markDarkDrivers ?? jest.fn(() => Promise.resolve(0));
  const sendDueNudges = over.sendDueNudges ?? jest.fn(() => Promise.resolve());
  const drivers = {
    markDarkDrivers,
    sendDueNudges,
  } as unknown as DriversService;
  return {
    sweeper: new DriverPresenceSweeper(drivers, env(nodeEnv)),
    markDarkDrivers,
    sendDueNudges,
  };
}

describe('DriverPresenceSweeper (#14)', () => {
  const T = 1_800_000_000_000;

  it('runs the dark pass then the nudge pass once per tick, on the tick clock (expected)', async () => {
    const { sweeper, markDarkDrivers, sendDueNudges } = build();

    await sweeper.tick(T);

    expect(markDarkDrivers).toHaveBeenCalledTimes(1);
    expect(markDarkDrivers).toHaveBeenCalledWith(T);
    expect(sendDueNudges).toHaveBeenCalledTimes(1);
    expect(sendDueNudges).toHaveBeenCalledWith(new Date(T));
    // Dark first, so a driver dark for 30 s is nudged on the same tick.
    expect(markDarkDrivers.mock.invocationCallOrder[0]).toBeLessThan(
      sendDueNudges.mock.invocationCallOrder[0]!,
    );
  });

  it('a throwing dark pass still runs the nudge pass and logs sweep_pass_failed (failure)', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { sweeper, sendDueNudges } = build({
      markDarkDrivers: jest.fn(() => Promise.reject(new Error('pg blinked'))),
    });

    await expect(sweeper.tick(T)).resolves.toBeUndefined();

    expect(sendDueNudges).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'driver.presence.sweep_pass_failed',
        pass: 'mark_dark',
        reason: 'pg blinked',
      }),
    );
    error.mockRestore();
  });

  it('an in-flight tick makes the overlapping one a no-op (edge)', async () => {
    let release!: () => void;
    const gate = new Promise<number>((resolve) => {
      release = () => resolve(0);
    });
    const { sweeper, markDarkDrivers } = build({
      markDarkDrivers: jest.fn(() => gate),
    });

    const first = sweeper.tick(T);
    await sweeper.tick(T + 1); // returns immediately — no second pass
    expect(markDarkDrivers).toHaveBeenCalledTimes(1);

    release();
    await first;
    await sweeper.tick(T + 2); // the lock is released after the first
    expect(markDarkDrivers).toHaveBeenCalledTimes(2);
  });

  it('does not start the interval under NODE_ENV=test, and does elsewhere (edge)', () => {
    jest.useFakeTimers();
    try {
      build({}, 'test').sweeper.onModuleInit();
      expect(jest.getTimerCount()).toBe(0);

      const { sweeper, markDarkDrivers } = build({}, 'development');
      sweeper.onModuleInit();
      expect(jest.getTimerCount()).toBe(1);
      jest.advanceTimersByTime(PRESENCE_SWEEP_INTERVAL_MS);
      expect(markDarkDrivers).toHaveBeenCalledTimes(1);

      sweeper.onModuleDestroy();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
