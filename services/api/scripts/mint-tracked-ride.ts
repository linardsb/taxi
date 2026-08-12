/**
 * `mint:ride` — mints a live tracked ride and COUNTS the paid route calls it
 * costs, one cell crossing at a time.
 *
 * This is the instrument #94's Level 4 step 3 asks for and could never run:
 * `geo.maps.route_fetched` is the maps seam's own success condition, and the
 * dev database has no tracking token to observe it through — tokens are minted
 * inside the booking flow, never by the seed. So the script books one.
 *
 * It boots the REAL `AppModule` in-process against the dev database and dev
 * Redis on its own ephemeral port, drives the whole chain over the wire (OTP →
 * vehicle → online → `POST /rides` → sweeper offer → accept), then walks the
 * driver due north in exact 0.001° latitude steps and polls `GET /track/:token`
 * five times per step. Each step crosses exactly one
 * `TRACKING_ETA_GRID_DECIMALS = 3` cell, so the expected call count is
 * arithmetic rather than an estimate.
 *
 * NOT A TEST. It does not run under jest and asserts nothing in CI. It is a
 * manual Level 4 instrument, held to `typecheck` and `lint` so it cannot rot,
 * and kept out of `dist/` by `tsconfig.build.json`.
 *
 * WHY IN-PROCESS rather than spawning the server and parsing its stdout: Nest
 * 11 renders object payloads as ANSI-coloured multi-line `util.inspect`, not
 * JSON — one record spans seven lines with single-quoted values, and a regex
 * over that would be the most fragile thing in the repo. Captured in-process
 * the payloads arrive as OBJECTS, and one capture stream serves both jobs the
 * log has to do here: reading the stub OTP and counting paid route calls.
 *
 * RUN CEILING: one run spends one OTP request per phone, and the phones are
 * fixed — so `OTP_MAX_REQUESTS_PER_HOUR` runs an hour, at least
 * `OTP_RESEND_COOLDOWN_SECONDS` apart. Two back-to-back runs (the idempotence
 * check) fit comfortably; a tight loop does not, and gets a named 429.
 *
 * Run:  pnpm --filter @taxi/api mint:ride
 */
import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  authSessionSchema,
  IDEMPOTENCY_KEY_HEADER,
  rideCreatedSchema,
  rideOfferEventSchema,
  trackingViewSchema,
  RT,
  type LatLng,
} from '@taxi/shared';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { APP_ENV, type Env } from '../src/common/config/env.schema';
import { KV_STORE, type KeyValueStore } from '../src/common/kv/kv.store';
import { maskPhone } from '../src/features/auth';
import {
  OTP_MAX_REQUESTS_PER_HOUR,
  OTP_RATE_WINDOW_SECONDS,
  OTP_RESEND_COOLDOWN_SECONDS,
} from '../src/features/auth/otp.policy';
// Deep imports on purpose. The geo barrel exports only the DI tokens, and the
// dispatch barrel only its services — but `routeCacheKey`/`routeFailureKey` are
// exported from the provider FILE precisely so a caller outside the class can
// address the same corridors, and `SWEEP_INTERVAL_MS` is what sizes the offer
// wait. Same sanctioned shape as `test/harness.ts` reaching for
// `StubMapsProvider`: an instrument may see one layer deeper than production.
import { SWEEP_INTERVAL_MS } from '../src/features/dispatch/dispatch.policy';
import {
  routeCacheKey,
  routeFailureKey,
} from '../src/features/geo/caching-maps.provider';
import {
  quantizeForEtaCache,
  TRACKING_ETA_GRID_DECIMALS,
  TRACKING_ETA_SPEED_METERS_PER_MINUTE,
  TRACKING_VIEW_MAX_PER_WINDOW,
  TRACKING_VIEW_WINDOW_SECONDS,
} from '../src/features/notifications/notifications.policy';
import { RedisIoAdapter } from '../src/features/realtime';

// ─────────────────────────────── parameters ───────────────────────────────

/**
 * `+371290` is this script's E.164 range — registered in the range comment at
 * `ride-lifecycle.integration.spec.ts`. FIXED, not fresh-per-run: fresh phones
 * would mint an unbounded user table in a dev database nothing ever resets.
 */
const RIDER_PHONE = '+371290001';
const DRIVER_PHONE = '+371290002';

/**
 * `vehicles_plate_uix` is `UNIQUE btree(upper(plate))` — GLOBALLY unique, not
 * per driver. Fixed plate + fixed driver is what makes the GET-then-POST below
 * idempotent across runs.
 */
const PLATE = 'MINT001';

/** Inside `centre` ONLY — `old_town` and `autoosta` nest inside it, and `rix` ships queue mode. */
const CENTRE_PICKUP = {
  location: { lat: 56.96, lng: 24.085 },
  address: 'Hanzas iela, Rīga',
};
const DESTINATION = {
  location: { lat: 56.9712, lng: 24.18 },
  address: 'Teika, Rīga',
};

const CELLS = Number(process.env['MINT_CELLS'] ?? 6);
const POLLS_PER_CELL = Number(process.env['MINT_POLLS_PER_CELL'] ?? 5);

/**
 * The walk: one longitude column, exact `.xxx0` latitudes.
 *
 * `quantizeForEtaCache` uses `toFixed(3)`, which ROUNDS — cell centres sit at
 * `.xxx0` and boundaries at `.xxx5`. Walking on exact `.xxx0` latitudes keeps
 * every step mid-cell, so float representation never gets to decide which cell
 * a position belongs to.
 */
const WALK_LNG = CENTRE_PICKUP.location.lng;
const WALK_BASE_LAT = CENTRE_PICKUP.location.lat + 0.001;
const cellLocation = (i: number): LatLng => ({
  lat: Number((WALK_BASE_LAT + i * 0.001).toFixed(TRACKING_ETA_GRID_DECIMALS)),
  lng: WALK_LNG,
});

const OTP_TIMEOUT_MS = 5_000;
const SOCKET_TIMEOUT_MS = 10_000;
/** ≥30 sweeps. A shorter wait cannot tell "no candidate" from "not swept yet". */
const OFFER_TIMEOUT_MS = 30 * SWEEP_INTERVAL_MS;
const POLL_GAP_MS = 60;

// ────────────────────────────── log capture ───────────────────────────────

/**
 * The whole mechanism. `Logger.overrideLogger()` swaps the static instance every
 * `new Logger(context)` in the app delegates to — including loggers constructed
 * AFTER the override, which is what lets a script installed before
 * `NestFactory.create` see `CachingMapsProvider`'s own counter.
 *
 * `super.log(...)` is LOAD-BEARING, not tidiness: without the tee, a run where
 * the offer never arrives prints nothing at all and is undiagnosable.
 */
class CapturingLogger extends ConsoleLogger {
  readonly events: Record<string, unknown>[] = [];

  override log(message: unknown, ...rest: unknown[]): void {
    if (typeof message === 'object' && message !== null) {
      this.events.push(message as Record<string, unknown>);
    }
    super.log(message, ...(rest as string[]));
  }
}

const capture = new CapturingLogger();
// Explicit, and NOT passed as `NestFactory.create(AppModule, { logger })`:
// `registerLoggerConfiguration` only overrides when the option is non-nil, so
// this call is the single point of interception — which is what makes Level 4
// step 5 ("comment this out, the script must fail loudly") a real control.
Logger.overrideLogger(capture);

const routeFetched = (caller: 'eta' | 'quote'): Record<string, unknown>[] =>
  capture.events.filter(
    (e) => e['event'] === 'geo.maps.route_fetched' && e['caller'] === caller,
  );

// ───────────────────────────────── helpers ────────────────────────────────

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for `read()` to answer something, or throws `message`. */
async function waitFor<T>(
  read: () => T | undefined,
  timeoutMs: number,
  message: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(message);
    await sleep(25);
  }
}

let baseUrl = '';

interface ApiResponse {
  status: number;
  body: unknown;
}

async function api(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  opts: { auth?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = {};
  if (opts.auth) headers['authorization'] = `Bearer ${opts.auth}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.idempotencyKey)
    headers[IDEMPOTENCY_KEY_HEADER] = opts.idempotencyKey;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* a non-JSON error page is still worth showing verbatim */
  }
  return { status: res.status, body };
}

/** `what` names the call, so a failure says which step broke rather than "400". */
function expectStatus(
  res: ApiResponse,
  expected: number,
  what: string,
): unknown {
  if (res.status !== expected) {
    throw new Error(
      `${what}: expected ${expected}, got ${res.status} — ${JSON.stringify(res.body)}`,
    );
  }
  return res.body;
}

/** `postgres://user:pass@host:5432/db` → `host:5432`. Credentials never printed. */
function hostPort(url: string): string {
  const u = new URL(url);
  return `${u.hostname}:${u.port === '' ? '(default)' : u.port}`;
}

async function connectSocket(
  accessToken: string,
  who: string,
): Promise<Socket> {
  // Bare token, no `Bearer` prefix — that is what `realtime.gateway.ts` reads
  // off `socket.handshake.auth`.
  const socket = io(baseUrl, {
    auth: { token: accessToken },
    transports: ['websocket'],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(`${who} socket did not connect in ${SOCKET_TIMEOUT_MS} ms`),
        ),
      SOCKET_TIMEOUT_MS,
    );
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    // A refused handshake surfaces HERE, not as a thrown error. Without this
    // listener a bad token hangs the script silently.
    socket.once('connect_error', (err: Error) => {
      clearTimeout(timer);
      reject(new Error(`${who} socket handshake refused: ${err.message}`));
    });
  });
  return socket;
}

// ──────────────────────────────── the run ─────────────────────────────────

interface Session {
  id: string;
  accessToken: string;
}

interface CellRow {
  index: number;
  location: LatLng;
  quantized: LatLng;
  views: number;
  /** Paid `caller:'eta'` calls attributable to each view of this cell, in order. */
  perView: number[];
  cell: string | null;
}

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const env = app.get<Env>(APP_ENV);

  const kv = app.get<KeyValueStore>(KV_STORE);

  let driver: Session | null = null;
  let rider: Session | null = null;
  let rideId: string | null = null;
  const sockets: Socket[] = [];

  // The teardown's reach starts at the CONTAINER, not at the first HTTP call:
  // a failure while dialling Redis must still close the database pool, or the
  // process hangs with nothing left to report.
  try {
    // ── which system did we actually reach? ───────────────────────────────
    // FIRST, before anything can fail against it, and printed by the RUNNING
    // APP rather than inferred: `localhost:5432` is shadowed by a brew
    // Postgres on this machine, and the compose Redis is published on
    // `REDIS_PORT` from `.env` while `.env.example` defaults to 6379. So both
    // "connection refused" and "NOAUTH" mean "you reached the wrong server",
    // and neither says which one without this line.
    console.log('── environment ──────────────────────────────────────────');
    console.log(
      `db=${hostPort(env.DATABASE_URL)} redis=${hostPort(env.REDIS_URL)}`,
    );
    console.log(
      `city=${env.DEFAULT_CITY_ID} node_env=${env.NODE_ENV} eta cache ttl=${env.MAPS_ETA_CACHE_TTL_SECONDS}s`,
    );

    // Reach Redis through the app's OWN client before the adapter builds two
    // more. `RedisIoAdapter.connectToRedis` assigns its clients only after
    // both ping, so a failure there leaks two ioredis instances that retry
    // forever and bury the real error under a scroll of `NOAUTH`.
    try {
      await kv.ttl('mint:ride:probe');
    } catch (error) {
      throw new Error(
        `cannot reach Redis at ${hostPort(env.REDIS_URL)}: ${error instanceof Error ? error.message : String(error)}\n` +
          `  \`NOAUTH\` means REDIS_URL names a password-protected server — almost always the wrong one.\n` +
          `  This checkout's Redis is the compose container: \`COMPOSE_PROJECT_NAME=taxi docker compose ps redis\`\n` +
          `  prints its published port, and REDIS_URL must match it.`,
      );
    }

    app.enableCors({ origin: env.CORS_ORIGINS });
    const adapter = new RedisIoAdapter(app, env.CORS_ORIGINS);
    await adapter.connectToRedis(env.REDIS_URL);
    app.useWebSocketAdapter(adapter);
    app.enableShutdownHooks();

    // Port 0 deliberately: the script must run alongside a `pnpm dev` already
    // holding 3001.
    await app.listen(0);
    // `getHttpServer()` is typed `any`; narrow it to the one method used here.
    const server = app.getHttpServer() as {
      address: () => AddressInfo | string | null;
    };
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('the http server reported no TCP address');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    console.log(`listening on ${baseUrl}`);

    // ── the poll budget, before spending any of it ────────────────────────
    const plannedViews = CELLS * POLLS_PER_CELL;
    console.log(
      `poll budget: ${CELLS} cells × ${POLLS_PER_CELL} polls + 1 page load = ` +
        `${plannedViews + 1} views vs TRACKING_VIEW_MAX_PER_WINDOW=${TRACKING_VIEW_MAX_PER_WINDOW}` +
        ` per ${TRACKING_VIEW_WINDOW_SECONDS} s`,
    );
    if (plannedViews + 1 > TRACKING_VIEW_MAX_PER_WINDOW) {
      throw new Error(
        `refusing to run: ${CELLS} × ${POLLS_PER_CELL} + 1 = ${plannedViews + 1} views exceeds ` +
          `TRACKING_VIEW_MAX_PER_WINDOW=${TRACKING_VIEW_MAX_PER_WINDOW}; the run would 429 mid-walk ` +
          `and the zero counts would be the throttle, not the cache. Lower MINT_CELLS/MINT_POLLS_PER_CELL.`,
      );
    }

    // ── pre-flight cache clear ────────────────────────────────────────────
    // WITHOUT THIS THE SCRIPT IS WRONG ON ITS SECOND RUN. Against real Redis
    // the corridors are still warm inside MAPS_ETA_CACHE_TTL_SECONDS, every
    // crossing is a hit, the count is 0 — which looks like a spectacular pass
    // and is a false one. `tracking.integration.spec.ts` never meets this,
    // because `InMemoryKeyValueStore` dies with the process.
    const plannedCells = Array.from({ length: CELLS }, (_, i) =>
      cellLocation(i),
    );
    for (const location of plannedCells) {
      // QUANTIZED, and to the pickup — that is exactly the pair
      // `TrackingService.roadEta` hands the seam. Clearing un-quantized
      // coordinates would clear nothing.
      const from = quantizeForEtaCache(location);
      await kv.del(routeCacheKey('eta', from, CENTRE_PICKUP.location));
      await kv.del(routeFailureKey('eta', from, CENTRE_PICKUP.location));
    }
    // The QUOTE corridor too, and this one is not in the plan: pricing caches
    // for MAPS_ROUTE_CACHE_TTL_SECONDS (24 h by default), so on a second run
    // inside a day `POST /rides` is a cache hit, emits no `caller:'quote'`
    // event, and the filter-discrimination assertion below fails. No fail key
    // to clear — `geo.module.ts` builds the quote facade with a literal `0`
    // failure TTL, so nothing ever writes one.
    await kv.del(
      routeCacheKey('quote', CENTRE_PICKUP.location, DESTINATION.location),
    );
    console.log(
      `pre-flight: cleared ${plannedCells.length} eta corridors + 1 quote corridor`,
    );

    // ── sign in ───────────────────────────────────────────────────────────
    rider = await signIn(RIDER_PHONE, 'rider');
    driver = await signIn(DRIVER_PHONE, 'driver');
    console.log('── actors ───────────────────────────────────────────────');
    console.log(`rider  ${maskPhone(RIDER_PHONE)}  ${rider.id}  role=rider`);
    console.log(`driver ${maskPhone(DRIVER_PHONE)}  ${driver.id}  role=driver`);

    // ── driver setup ──────────────────────────────────────────────────────
    await ensureVehicle(driver.accessToken);
    expectStatus(
      await api('PUT', '/drivers/me/status', {
        auth: driver.accessToken,
        body: { status: 'online' },
      }),
      200,
      'PUT /drivers/me/status online',
    );

    const driverSocket = await connectSocket(driver.accessToken, 'driver');
    sockets.push(driverSocket);

    const offers: { id: string; rideId: string }[] = [];
    driverSocket.on(RT.rideOffer, (payload: unknown) => {
      const parsed = rideOfferEventSchema.safeParse(payload);
      if (parsed.success) {
        offers.push({ id: parsed.data.id, rideId: parsed.data.rideId });
      }
    });

    // The driver starts AT cell 0, not merely near it. Any other start
    // coordinate is a 7th, uncleared corridor that a stale confirmation read
    // could route — inflating the total and reading as an over-reporting
    // counter rather than as the script's own doing.
    const start = cellLocation(0);
    driverSocket.emit(RT.driverLocation, {
      location: start,
      at: new Date().toISOString(),
    });
    console.log(`driver online at cell 0 ${start.lat},${start.lng}`);

    // ── book ──────────────────────────────────────────────────────────────
    const created = await api('POST', '/rides', {
      auth: rider.accessToken,
      idempotencyKey: randomUUID(),
      body: {
        pickup: CENTRE_PICKUP,
        destination: DESTINATION,
        paymentMethod: 'cash',
      },
    });
    if (created.status !== 201) {
      // `rides.geozone_id` is NOT NULL, filled from a PostGIS containment
      // lookup — an unseeded database breaks HERE, and nowhere clearer.
      throw new Error(
        `POST /rides: expected 201, got ${created.status} — ${JSON.stringify(created.body)}\n` +
          `  if this names a geozone: no geozone contains ${CENTRE_PICKUP.location.lat},${CENTRE_PICKUP.location.lng} → ` +
          `run \`COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/db seed\``,
      );
    }
    const { ride } = rideCreatedSchema.parse(created.body);
    rideId = ride.id;
    const token = ride.trackingToken;
    if (token === null) {
      throw new Error(
        'the created ride carries no tracking token — `mintTrackingToken()` did not run, and there is nothing to observe',
      );
    }

    // ── wait for OUR offer ────────────────────────────────────────────────
    // The dev database already holds awaiting rides and the sweeper ticks over
    // ALL of them every second. An unfiltered listener would accept someone
    // else's ride — or consume this driver before ours is offered.
    const declined = new Set<string>();
    const ourOffer = await waitFor(
      () => {
        for (const offer of offers) {
          if (offer.rideId === rideId) return offer.id;
          if (!declined.has(offer.id)) {
            declined.add(offer.id);
            // Declined rather than ignored, so the cascade moves on instead of
            // waiting out the offer's expiry.
            //
            // `.catch`, not bare `void`: `void` satisfies `no-floating-promises`
            // but attaches no handler, so a reject (connection reset mid-cascade)
            // is an unhandled rejection — fatal in Node ≥ 15. The process would
            // die before teardown and leave the driver `on_ride`, the exact state
            // that makes the NEXT run find no candidate.
            api('POST', `/dispatch/offers/${offer.id}/decline`, {
              auth: driver?.accessToken,
            }).catch(() => {});
          }
        }
        return undefined;
      },
      OFFER_TIMEOUT_MS,
      `no offer for ride ${rideId} within ${OFFER_TIMEOUT_MS} ms (${OFFER_TIMEOUT_MS / SWEEP_INTERVAL_MS} sweeps).\n` +
        `  causes, in order of likelihood: the driver is not a dispatch candidate (offline, no vehicle, still \`on_ride\` from a previous run),\n` +
        `  no geozone contains the pickup, or the sweeper never started because NODE_ENV=test`,
    );

    expectStatus(
      await api('POST', `/dispatch/offers/${ourOffer}/accept`, {
        auth: driver.accessToken,
      }),
      201,
      `POST /dispatch/offers/${ourOffer}/accept`,
    );
    console.log('── ride ─────────────────────────────────────────────────');
    console.log(
      `ride=${rideId} offer=${ourOffer} token=${token} (${token.length} chars)`,
    );

    // ── the measured walk ─────────────────────────────────────────────────
    const rows: CellRow[] = [];
    for (let i = 0; i < CELLS; i++) {
      rows.push(await walkCell(i, driverSocket, token));
      // THE POSITIVE CONTROL, and it runs before any zero is trusted. Zero is
      // also what a broken counter, a broken logger override, a warm cache and
      // a driver who never moved all produce — four failure modes, one
      // indistinguishable output.
      if (i === 0 && rows[0]!.perView.reduce((a, b) => a + b, 0) === 0) {
        throw new Error(
          'positive control FAILED: no `geo.maps.route_fetched` captured on the first view of a freshly cleared cell.\n' +
            '  This is NOT a cache result — log interception is broken, or the ETA never ran (no driver, wrong status, no position).\n' +
            '  Every zero below would be meaningless.',
        );
      }
    }

    report(rows, token);
    assertInvariants(rows);
    console.log(
      '\nPASS — one paid route call per cell crossing, zero per sub-cell poll.',
    );
  } finally {
    await teardown(app, { rider, driver, rideId, sockets });
  }
}

/**
 * `POST /auth/otp/request`, read the code out of the CAPTURED
 * `auth.otp.stub_sent`, `POST /auth/otp/verify`.
 */
async function signIn(
  phone: string,
  role: 'rider' | 'driver',
): Promise<Session> {
  const masked = maskPhone(phone);
  const seen = capture.events.length;
  const requested = await api('POST', '/auth/otp/request', {
    body: { phone, role },
  });
  // THE INSTRUMENT'S RUN CEILING, and it has to be named or it reads as a bug
  // in the script. One run costs one OTP request per phone, so the phones fix
  // this tool at OTP_MAX_REQUESTS_PER_HOUR runs an hour with at least
  // OTP_RESEND_COOLDOWN_SECONDS between them. Two consecutive runs — what the
  // idempotence check needs — fit; a tight loop of six does not.
  if (requested.status === 429) {
    throw new Error(
      `POST /auth/otp/request ${masked}: 429 — ${JSON.stringify(requested.body)}\n` +
        `  \`resend_too_soon\` → wait out OTP_RESEND_COOLDOWN_SECONDS=${OTP_RESEND_COOLDOWN_SECONDS} s between runs.\n` +
        `  \`too_many_requests\` → this phone has spent its OTP_MAX_REQUESTS_PER_HOUR=${OTP_MAX_REQUESTS_PER_HOUR} ` +
        `requests per OTP_RATE_WINDOW_SECONDS=${OTP_RATE_WINDOW_SECONDS} s window.\n` +
        `  Neither is a defect in this script or in the cache it measures — it is the SMS-spend cap doing its job.`,
    );
  }
  expectStatus(requested, 200, `POST /auth/otp/request ${masked}`);

  // The send is fire-and-forget, so the response can beat the log line. The
  // payload's `phone` is MASKED (`stub-sms.provider.ts`) — match on that.
  const code = await waitFor(
    () => {
      for (const event of capture.events.slice(seen)) {
        if (
          event['event'] === 'auth.otp.stub_sent' &&
          event['phone'] === masked &&
          typeof event['code'] === 'string'
        ) {
          return event['code'];
        }
      }
      return undefined;
    },
    OTP_TIMEOUT_MS,
    `no \`auth.otp.stub_sent\` captured for ${masked} in ${OTP_TIMEOUT_MS} ms.\n` +
      `  Either LOG INTERCEPTION IS BROKEN — the same failure that would later turn every paid-call\n` +
      `  count into a meaningless zero, which is why sign-in reaching the capture first is load-bearing —\n` +
      `  or the TWILIO_* trio is set and the real provider is bound, which logs no code at all. Unset it.`,
  );

  const verified = expectStatus(
    await api('POST', '/auth/otp/verify', { body: { phone, code } }),
    200,
    `POST /auth/otp/verify ${masked}`,
  );
  const session = authSessionSchema.parse(verified);

  // NOT defensive padding. `auth.service.ts` issues the session with the
  // PERSISTED row's role, so the `role` argument only takes effect when the
  // user is created — and these phones are fixed against a database nothing
  // resets. One earlier run that signed this number in as the other role makes
  // it that role permanently, and the failure would otherwise surface much
  // later as a 403 on `POST /rides` naming nothing.
  if (session.user.role !== role) {
    throw new Error(
      `phone ${masked} is registered as \`${session.user.role}\`, not \`${role}\` — ` +
        `pick an unused number in the +371290 range and update this script`,
    );
  }
  return { id: session.user.id, accessToken: session.accessToken };
}

/** GET before POST: the plate is globally unique, so a blind POST fails on run 2. */
async function ensureVehicle(auth: string): Promise<void> {
  const listed = expectStatus(
    await api('GET', '/drivers/me/vehicles', { auth }),
    200,
    'GET /drivers/me/vehicles',
  );
  const owned = Array.isArray(listed) ? (listed as { plate?: unknown }[]) : [];
  if (owned.some((v) => String(v.plate).toUpperCase() === PLATE)) {
    console.log(`vehicle ${PLATE} already registered — reused`);
    return;
  }
  expectStatus(
    await api('POST', '/drivers/me/vehicles', {
      auth,
      body: {
        plate: PLATE,
        make: 'Skoda',
        model: 'Octavia',
        year: 2019,
        passengerSeats: 4,
        hasChildSeat: false,
      },
    }),
    201,
    `POST /drivers/me/vehicles ${PLATE}`,
  );
  console.log(`vehicle ${PLATE} created`);
}

/**
 * One cell: move, confirm the move LANDED, then poll out the rest of the cell's
 * budget — recording the paid-call delta of every single view.
 *
 * The confirmation read is itself a poll and costs a route call on a fresh
 * cell, so it counts as one of the cell's views rather than as overhead. Count
 * it as overhead and the arithmetic is off by one per cell.
 */
async function walkCell(
  index: number,
  socket: Socket,
  token: string,
): Promise<CellRow> {
  const location = cellLocation(index);
  const perView: number[] = [];
  let cell: string | null = null;

  // `handleLocation` never acks and never throws — a ping is fire-and-forget,
  // so unlike the spec's `moveDriver` there is no return value to assert on.
  // Read the position back through the page instead, or a silently dropped
  // ping shows up as a mysteriously missing route call several cells later.
  socket.emit(RT.driverLocation, {
    location,
    at: new Date().toISOString(),
  });

  let landed = false;
  // Capped at POLLS_PER_CELL so a cell can never spend more than its share of
  // the token's window — the budget guard's arithmetic stays a worst case.
  for (let attempt = 0; attempt < POLLS_PER_CELL; attempt++) {
    await sleep(POLL_GAP_MS);
    const before = routeFetched('eta');
    const page = await view(token);
    const after = routeFetched('eta');
    perView.push(after.length - before.length);
    const fresh = after[after.length - 1];
    if (after.length > before.length && typeof fresh?.['cell'] === 'string') {
      cell = fresh['cell'];
    }
    if (
      page.position !== null &&
      Math.abs(page.position.lat - location.lat) < 5e-5
    ) {
      landed = true;
      break;
    }
  }
  if (!landed) {
    throw new Error(
      `cell ${index}: the page never showed the driver at ${location.lat} after ${POLLS_PER_CELL} views — ` +
        `the location ping was dropped (Redis unreachable, or the driver left the online set)`,
    );
  }

  while (perView.length < POLLS_PER_CELL) {
    await sleep(POLL_GAP_MS);
    const before = routeFetched('eta');
    await view(token);
    perView.push(routeFetched('eta').length - before.length);
  }

  return {
    index,
    location,
    quantized: quantizeForEtaCache(location),
    views: perView.length,
    perView,
    cell,
  };
}

async function view(token: string): Promise<{
  position: { lat: number; lng: number } | null;
  etaMinutes: number | null;
}> {
  const res = await api('GET', `/track/${token}`);
  if (res.status === 429) {
    throw new Error(
      `GET /track/:token answered 429 — the run exceeded TRACKING_VIEW_MAX_PER_WINDOW=${TRACKING_VIEW_MAX_PER_WINDOW} ` +
        `per ${TRACKING_VIEW_WINDOW_SECONDS} s. Every count from here is the throttle, not the cache.`,
    );
  }
  return trackingViewSchema.parse(expectStatus(res, 200, 'GET /track/:token'));
}

// ──────────────────────────── report & assertions ─────────────────────────

function report(rows: CellRow[], token: string): void {
  const totalViews = rows.reduce((sum, r) => sum + r.views, 0);
  const etaCalls = routeFetched('eta').length;
  const quoteCalls = routeFetched('quote').length;

  console.log('\n── per cell ─────────────────────────────────────────────');
  console.log(
    '  #   quantized origin        cell        views  eta calls per view',
  );
  for (const row of rows) {
    const origin = `${row.quantized.lat.toFixed(3)},${row.quantized.lng.toFixed(3)}`;
    console.log(
      `  ${String(row.index).padStart(2)}  ${origin.padEnd(22)} ${(row.cell ?? '—').padEnd(11)} ` +
        `${String(row.views).padStart(5)}  [${row.perView.join(', ')}]`,
    );
  }

  console.log('\n── summary ──────────────────────────────────────────────');
  console.log(`token                       ${token}`);
  console.log(
    `grid                        TRACKING_ETA_GRID_DECIMALS=${TRACKING_ETA_GRID_DECIMALS}` +
      ` → ~111 m N/S × ~61 m E/W at Rīga's ~57°N (notifications.policy.ts)`,
  );
  console.log(
    `views                       ${totalViews} = ${rows.length} cells × ${POLLS_PER_CELL} polls`,
  );
  console.log(
    `paid eta route calls        ${etaCalls} = one per cell crossing ` +
      `(${new Set(rows.map((r) => r.cell)).size} distinct corridors)`,
  );
  console.log(
    `paid quote route calls      ${quoteCalls} — POST /rides pricing, proves the caller filter discriminates`,
  );
  // NAME THE CASE. This run emits ONE position per cell and polls it
  // `POLLS_PER_CELL` times, so the position is byte-identical across a cell's
  // polls and `quantizeForEtaCache` (toFixed(3)) is an IDENTITY function on
  // every coordinate this walk generates. The unquantized cost of THIS run is
  // therefore `etaCalls`, not `totalViews`: what the zeros above demonstrate is
  // `CachingMapsProvider`'s 4-decimal corridor cache, which predates #87's grid.
  console.log(
    `\nunquantized cost of THIS run ${etaCalls} — NOT ${totalViews}. Every position here is already on the\n` +
      "3-decimal grid and does not move between a cell's polls, so the grid is an identity function for\n" +
      "this walk and the zeros above are the 4-dp corridor cache's, not the grid's.\n" +
      `Under real per-poll GPS jitter — the case notifications.policy.ts:44-51 names, and the one this\n` +
      `walk does NOT have — each poll would key a distinct corridor and the unquantized cost would be\n` +
      `${totalViews} (${rows.length} cells × ${POLLS_PER_CELL} polls), a ${(totalViews / Math.max(1, etaCalls)).toFixed(0)}× reduction. That is ARITHMETIC, not a measurement:\n` +
      'this script does not run an unquantized pass, and nothing here observed it.',
  );

  // NAME THE HEADING. #87 shipped a best-case interval labelled worst-case;
  // every number here says which case it describes.
  console.log(
    "\nheading: due NORTH. 0.001° of latitude ≈ 111.3 m — the cell's LARGEST dimension, so the\n" +
      'FEWEST crossings per metre driven, the BEST case for spend. Per `notifications.policy.ts`, at\n' +
      `${TRACKING_ETA_SPEED_METERS_PER_MINUTE} m/min a crossing costs one call per ~16 s due N/S (best), ~8.8 s due E/W,\n` +
      '~7.7 s on the worst heading (~61° off north), and ~8.9 s averaged over a uniform heading.\n' +
      'This script does NOT measure that cadence. The invariant under test — one paid call per cell\n' +
      'crossing — is heading-independent; the crossing RATE is not, and is not what this counts. Due\n' +
      'north is chosen because each step then crosses exactly one boundary, making the expected count\n' +
      'arithmetic rather than an estimate.',
  );
}

function assertInvariants(rows: CellRow[]): void {
  const problems: string[] = [];
  const etaCalls = routeFetched('eta').length;
  const quoteCalls = routeFetched('quote').length;

  if (etaCalls !== rows.length) {
    problems.push(
      `expected ${rows.length} \`caller:'eta'\` calls (one per cell), counted ${etaCalls}`,
    );
  }

  // DISTINCT cells, not just the total: a total of 6 is also what "one corridor
  // routed 6 times" looks like. This is the assertion that proves ONE PER CELL.
  const distinct = new Set(rows.map((r) => r.cell));
  if (distinct.size !== rows.length || distinct.has(null)) {
    problems.push(
      `expected ${rows.length} distinct \`cell\` values, saw ${distinct.size} (${[...distinct].join(', ')})`,
    );
  }

  for (const row of rows) {
    const paid = row.perView.filter((n) => n > 0);
    const total = row.perView.reduce((a, b) => a + b, 0);
    if (total !== 1 || paid.length !== 1) {
      problems.push(
        `cell ${row.index}: expected exactly one paid view and zero on every other poll, saw [${row.perView.join(', ')}]`,
      );
    }
  }

  // Not decoration: it proves the `caller` filter is DISCRIMINATING rather than
  // matching nothing. `POST /rides` pricing routes through the `quote` facade.
  if (quoteCalls < 1) {
    problems.push(
      `expected ≥1 \`caller:'quote'\` call from POST /rides pricing, counted 0 — the caller filter may be matching nothing`,
    );
  }

  if (problems.length > 0) {
    throw new Error(`FAILED:\n  - ${problems.join('\n  - ')}`);
  }
}

// ─────────────────────────────── teardown ─────────────────────────────────

/**
 * WITHOUT THIS, RUN 2 FAILS. A driver left `on_ride` is never a dispatch
 * candidate again, and it surfaces as "no offer arrived" with nothing pointing
 * at the previous run. It must therefore run on the failure path too.
 */
async function teardown(
  app: { close: () => Promise<void> },
  state: {
    rider: Session | null;
    driver: Session | null;
    rideId: string | null;
    sockets: Socket[];
  },
): Promise<void> {
  console.log('\n── teardown ─────────────────────────────────────────────');

  // Over the wire, not a direct status write: `cancel` goes through the state
  // machine and its `releaseFromRide` is the ONE line that takes the driver
  // back out of `on_ride`.
  if (state.rideId !== null && state.rider !== null) {
    const res = await api('POST', `/rides/${state.rideId}/cancel`, {
      auth: state.rider.accessToken,
      body: { reason: 'mint:ride teardown' },
    }).catch((err: unknown) => ({ status: 0, body: String(err) }));
    console.log(`cancel ride ${state.rideId} → ${res.status}`);
  }

  if (state.driver !== null) {
    // Guarded like the cancel above: a throw from inside `finally` REPLACES the
    // original error, so an unguarded reject here prints the teardown's failure
    // instead of the run's real diagnosis — and skips `app.close()`, leaving the
    // process hung rather than exiting 1.
    const me = await api('GET', '/drivers/me', {
      auth: state.driver.accessToken,
    }).catch((err: unknown) => ({ status: 0, body: String(err) }));
    // `DriverMe` is `{ profile, vehicles }` — the status is one level in.
    const status = (me.body as { profile?: { status?: unknown } })?.profile
      ?.status;
    console.log(`driver status after cancel → ${String(status)}`);
    if (status === 'on_ride') {
      console.log(
        '  WARNING: driver is still `on_ride` — the next run will find no candidate',
      );
    }
    // Deliberately `offline`, not `online`: an `online` driver with no process
    // behind them is the ghost presence `clearPresenceOnDisconnect` exists to
    // prevent. This also drops the recorded position, so the next run starts
    // from a clean presence state.
    const off = await api('PUT', '/drivers/me/status', {
      auth: state.driver.accessToken,
      body: { status: 'offline' },
    }).catch((err: unknown) => ({ status: 0, body: String(err) }));
    console.log(`driver → offline (${off.status})`);
  }

  for (const socket of state.sockets) socket.disconnect();
  // Lets the gateway's disconnect cleanup land before the container goes away.
  await sleep(100);
  await app.close();
  console.log('app closed');
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
