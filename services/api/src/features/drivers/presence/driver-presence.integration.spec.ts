import { Logger } from '@nestjs/common';
import { drivers } from '@taxi/db';
import { authSessionSchema, formatMessage, RT } from '@taxi/shared';
import { eq } from 'drizzle-orm';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import {
  closeClients,
  connectClient,
  createTestApp,
  phoneFor,
  type TestApp,
} from '../../../../test/harness';
import { APP_ENV, type Env } from '../../../common/config/env.schema';
import {
  OFFLINE_NUDGE_DELAY_SECONDS,
  PRESENCE_DARK_AFTER_SECONDS,
} from '../location/driver-location.policy';
import { DriverPresenceSweeper } from './driver-presence.sweeper';

/** `+371291` is this spec file's E.164 range — see phoneFor(). */
const p = (n: number) => phoneFor('+371291', n);
const RIGA = { lat: 56.9512, lng: 24.1136 };
const DARK_MS = PRESENCE_DARK_AFTER_SECONDS * 1000;
const NUDGE_MS = OFFLINE_NUDGE_DELAY_SECONDS * 1000;
const token = (n: number) =>
  `ExponentPushToken[presence${String(n).padStart(14, '0')}]`;

/**
 * The whole chain over the real module graph: socket → ack → dark sweep /
 * disconnect cleanup → `offline_nudge_due_at` → nudge. The sweeper never
 * auto-starts under test, so every tick here is driven by hand with a clock
 * the case chooses — no sleeping.
 */
describe('driver presence: dark detection + nudge (integration, #14)', () => {
  let ctx: TestApp;
  let http: ReturnType<typeof request>;
  let port: number;
  let cityId: string;
  let sweeper: DriverPresenceSweeper;
  let plateSeq = 0;

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.app.listen(0);
    const server = ctx.app.getHttpServer() as { address(): AddressInfo | null };
    port = server.address()!.port;
    http = request(server as unknown as Parameters<typeof request>[0]);
    cityId = ctx.app.get<Env>(APP_ENV).DEFAULT_CITY_ID;
    sweeper = ctx.app.get(DriverPresenceSweeper);
  });

  // Order matters: clients first, app second, or jest hangs on open handles.
  afterEach(closeClients);
  afterAll(async () => {
    await ctx.app.close();
  });

  /** Signs a driver in, gives them a car, optionally a push token. */
  async function driver(n: number, opts: { pushToken?: boolean } = {}) {
    const phone = p(n);
    await http
      .post('/auth/otp/request')
      .send({ phone, role: 'driver' })
      .expect(200);
    const code = ctx.sms.lastCodeFor(phone)!;
    const res = await http
      .post('/auth/otp/verify')
      .send({ phone, code })
      .expect(200);
    const session = authSessionSchema.parse(res.body);
    const auth = `Bearer ${session.accessToken}`;
    await http
      .post('/drivers/me/vehicles')
      .set('authorization', auth)
      .send({
        plate: `PN${String(++plateSeq).padStart(4, '0')}`,
        make: 'Skoda',
        model: 'Octavia',
        year: 2019,
        passengerSeats: 4,
      })
      .expect(201);
    if (opts.pushToken) {
      await http
        .put('/drivers/me/push-token')
        .set('authorization', auth)
        .send({ token: token(n) })
        .expect(204);
    }
    const id = session.user.id;
    return {
      id,
      auth,
      token: token(n),
      setStatus: (status: 'online' | 'offline') =>
        http
          .put('/drivers/me/status')
          .set('authorization', auth)
          .send({ status })
          .expect(200),
      connect: () => connectClient(port, session.accessToken),
      row: async () =>
        (await ctx.db.select().from(drivers).where(eq(drivers.userId, id)))[0]!,
      sentTo: () => ctx.push.sent.filter((s) => s.token === token(n)),
    };
  }

  /** Online through the real route (Postgres + the seeded `seen` score), socket up, one ping acked. Returns the clock after the ack. */
  async function onlineAndPinged(d: Awaited<ReturnType<typeof driver>>) {
    await d.setStatus('online');
    const socket = await d.connect();
    const ack: unknown = await socket
      .timeout(1000)
      .emitWithAck(RT.driverLocation, {
        location: RIGA,
        at: new Date().toISOString(),
      });
    expect(ack).toEqual({ accepted: true });
    return { socket, T: Date.now() };
  }

  it('marks a silent-but-connected driver dark, then nudges once the delay passes (expected)', async () => {
    const d = await driver(1, { pushToken: true });
    const { socket, T } = await onlineAndPinged(d);
    const log = jest.spyOn(Logger.prototype, 'log');

    try {
      // Just past the freshness window, on the sweeper's own clock.
      await sweeper.tick(T + DARK_MS + 1000);

      const row = await d.row();
      expect(row.status).toBe('offline');
      expect(ctx.locations.isOnline(cityId, d.id)).toBe(false);
      expect(socket.connected).toBe(true); // dark does not disconnect
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'driver.presence.status_changed',
          driverId: d.id,
          to: 'offline',
          reason: 'dark',
        }),
      );
      // Stamped relative to the tick's clock: due = tick + 30 s.
      const due = row.offlineNudgeDueAt!.getTime();
      expect(Math.abs(due - (T + DARK_MS + 1000 + NUDGE_MS))).toBeLessThan(
        1000,
      );
      expect(d.sentTo()).toHaveLength(0); // not yet

      await sweeper.tick(T + DARK_MS + 1000 + NUDGE_MS + 1000);

      expect(d.sentTo()).toHaveLength(1);
      expect(d.sentTo()[0]!.message).toEqual({
        title: formatMessage('lv', 'push.offline_nudge_title'),
        body: formatMessage('lv', 'push.offline_nudge_body'),
        data: { kind: 'offline_nudge' },
      });
      expect((await d.row()).offlineNudgeDueAt).toBeNull(); // the claim
    } finally {
      log.mockRestore();
    }
  });

  it('a lost socket takes the driver offline and the same delay nudges them (edge)', async () => {
    const d = await driver(2, { pushToken: true });
    const { socket } = await onlineAndPinged(d);

    socket.close();
    await waitFor(async () => (await d.row()).status === 'offline');
    expect((await d.row()).offlineNudgeDueAt).not.toBeNull();

    await sweeper.tick(Date.now() + NUDGE_MS + 1000);

    expect(d.sentTo()).toHaveLength(1);
  });

  it('a reconnect inside the delay cancels the nudge (edge — a tunnel is not a reason to buzz)', async () => {
    const d = await driver(3, { pushToken: true });
    const { socket } = await onlineAndPinged(d);
    socket.close();
    await waitFor(async () => (await d.row()).status === 'offline');

    await d.setStatus('online'); // what the app does on `connect`

    expect((await d.row()).offlineNudgeDueAt).toBeNull();
    await sweeper.tick(Date.now() + NUDGE_MS + 1000);
    expect(d.sentTo()).toHaveLength(0);

    await d.setStatus('offline'); // leave nothing for later ticks to sweep
  });

  it('skips the nudge for a driver with no token (failure — nothing to send to)', async () => {
    const d = await driver(4);
    const { T } = await onlineAndPinged(d);
    const before = ctx.push.sent.length;

    await sweeper.tick(T + DARK_MS + 1000);
    await sweeper.tick(T + DARK_MS + 1000 + NUDGE_MS + 1000);

    expect(ctx.push.sent).toHaveLength(before);
    expect((await d.row()).offlineNudgeDueAt).toBeNull(); // claimed, then skipped
  });

  it('forgets the token on DeviceNotRegistered (failure)', async () => {
    const d = await driver(5, { pushToken: true });
    const { T } = await onlineAndPinged(d);

    await sweeper.tick(T + DARK_MS + 1000);
    ctx.push.nextResult = { ok: false, reason: 'device_not_registered' };
    await sweeper.tick(T + DARK_MS + 1000 + NUDGE_MS + 1000);

    expect(d.sentTo()).toHaveLength(1);
    expect((await d.row()).pushToken).toBeNull();
  });

  it('a driver who went online and never pinged is dark after the window too (edge — the seeded seen score)', async () => {
    const d = await driver(6);
    await d.setStatus('online');
    const T = Date.now();

    await sweeper.tick(T + DARK_MS + 1000);

    expect((await d.row()).status).toBe('offline');
    expect(ctx.locations.isOnline(cityId, d.id)).toBe(false);
  });

  it('never sweeps an on_ride driver, however silent (edge — #11 owns that status)', async () => {
    const d = await driver(7);
    const { T } = await onlineAndPinged(d);
    await ctx.db
      .update(drivers)
      .set({ status: 'on_ride' })
      .where(eq(drivers.userId, d.id));

    try {
      await sweeper.tick(T + DARK_MS + 1000);

      expect((await d.row()).status).toBe('on_ride');
      expect(ctx.locations.isOnline(cityId, d.id)).toBe(true);
    } finally {
      await ctx.db
        .update(drivers)
        .set({ status: 'offline' })
        .where(eq(drivers.userId, d.id));
      await ctx.locations.markOffline(cityId, d.id);
    }
  });
});

/** Polls `check` up to `timeoutMs`; the disconnect handler is async relative to close. */
async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for: ${check.toString()}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
