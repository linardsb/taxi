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
 * Each of a cell's polls sits at its OWN deterministic sub-cell offset — an
 * integer multiple of `COORD_PRECISION`'s 1e-4°, latitude only — so every poll
 * keys a distinct 4-dp corridor while still quantizing to the one cell centre.
 * That is what #108 added, and it is load-bearing: without it every walked
 * position already sat on the 3-dp grid, `quantizeForEtaCache` was an identity
 * function for the whole run, and the zeros belonged to the 4-dp corridor cache
 * rather than to #87's grid.
 *
 * The run therefore has TWO PASSES: the tracked walk (grid on), and a replay of
 * the positions the page reported through the same `MAPS_PROVIDER_ETA` facade
 * with quantization removed. Both counts come from `geo.maps.route_fetched`, so
 * the reduction the summary prints is OBSERVED rather than derived, and the
 * substitution of identity for `quantizeForEtaCache` is the only difference
 * between them — which is what attributes it to the grid.
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
  type MapsProvider,
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
// Deep imports on purpose, and only where the barrel does not carry the symbol.
// `routeCacheKey`/`routeFailureKey` are exported from the provider FILE
// precisely so a caller outside the class can address the same corridors, and
// the dispatch barrel exports only its services, so `SWEEP_INTERVAL_MS` — what
// sizes the offer wait — comes from the policy file. Same sanctioned shape as
// `test/harness.ts` reaching for `StubMapsProvider`: an instrument may see one
// layer deeper than production. `COORD_PRECISION` is NOT in that set: #108 made
// it a contract of the geo slice, so it comes through the barrel like the token.
import {
  DRIVER_LOCATION_STORE,
  type DriverLocationStore,
} from '../src/features/drivers';
import { SWEEP_INTERVAL_MS } from '../src/features/dispatch/dispatch.policy';
import { COORD_PRECISION, MAPS_PROVIDER_ETA } from '../src/features/geo';
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

/**
 * Sub-cell jitter, in DEGREES OF LATITUDE — the walk's own axis, so one
 * geometry describes both the step and the jitter.
 *
 * The step is the CORRIDOR CACHE's own precision (`COORD_PRECISION = 4`), which
 * is the smallest move that mints a distinct 4-dp cache key — and therefore the
 * smallest jitter under which an unquantized pass costs anything. Derived, never
 * a literal `1e-4`: at equal precision the two passes would report the same
 * count and the reduction would silently read 1×.
 *
 * ~11 m per step. With POLLS_PER_CELL = 5 the offsets are −2…+2 steps, so a
 * poll sits at most 0.0002° ≈ 22 m of LATITUDE from the cell centre (the same
 * figure is ~12 m of LONGITUDE at Rīga's ~57°N — this jitter is latitude, so
 * 22 m is the number). Inside the plan's ±0.0004° bound — the GOTCHA in
 * `mint-tracked-ride-dev-script.md`'s walk task that begins "sub-cell jitter,
 * if added, must stay within ±0.0004° lat of the centre"; cited by its text
 * because #108's own amendment to that file moved its line number. The bound is
 * itself a margin below the half-cell: the 3-dp grid is 0.001° wide, so the
 * boundary is at ±0.0005° (`HALF_CELL_DEG`).
 * Real GPS jitter is ±10–20 m (`notifications.policy.ts:49`) — same order.
 */
const JITTER_STEP_DEG = 10 ** -COORD_PRECISION;
/** Half a step. Nearest-neighbour: it cannot confuse two jitter positions (1 step apart)
 *  and clears Redis GEO's ~0.6 m (~5.4e-6°) storage error by 9.3× (5e-5 / 5.39e-6). */
const JITTER_MATCH_TOLERANCE_DEG = JITTER_STEP_DEG / 2;
/** ±0.0004° — the plan's bound, not the cell edge (`HALF_CELL_DEG`). */
const MAX_JITTER_STEPS = 4;
/**
 * Half a cell, DERIVED. `quantizeForEtaCache` uses `toFixed(3)`, which rounds,
 * so a 3-dp cell is `10 ** -3` wide and its boundaries sit at `.xxx5`. Every
 * printed half-cell figure comes from here rather than from a `0.0005` literal:
 * if the grid is ever retuned, the bound it is a margin below moves with it.
 */
const HALF_CELL_DEG = 10 ** -TRACKING_ETA_GRID_DECIMALS / 2;
/** Metres per degree of LATITUDE. Only ever applied to the latitude jitter. */
const METERS_PER_DEGREE_LAT = 111_320;

/** Steps from the cell centre for poll `p`: symmetric, integer, strictly increasing. */
const jitterSteps = (poll: number): number =>
  poll - Math.floor((POLLS_PER_CELL - 1) / 2);

/** The cell's centre nudged by poll `p`'s jitter. Latitude only. */
const pollLocation = (cellIndex: number, poll: number): LatLng => {
  const centre = cellLocation(cellIndex);
  return {
    lat: Number(
      (centre.lat + jitterSteps(poll) * JITTER_STEP_DEG).toFixed(
        COORD_PRECISION,
      ),
    ),
    lng: centre.lng,
  };
};

const OTP_TIMEOUT_MS = 5_000;
const SOCKET_TIMEOUT_MS = 10_000;
/** ≥30 sweeps. A shorter wait cannot tell "no candidate" from "not swept yet". */
const OFFER_TIMEOUT_MS = 30 * SWEEP_INTERVAL_MS;
const POLL_GAP_MS = 60;
/** How long one poll's ping has to reach Redis before the run gives up on it. */
const PING_SETTLE_TIMEOUT_MS = 2_000;

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
  /** The cell's own centre, snapped. Nothing reads the raw centre — the table,
   *  the assertions and pass B all key off this or off `observed`. */
  quantized: LatLng;
  views: number;
  /** Paid `caller:'eta'` calls attributable to each view of this cell, in order. */
  perView: number[];
  cell: string | null;
  /**
   * The position the page REPORTED for each poll, in order. Pass B replays
   * these, not the intended ones: whatever the page saw is what an unquantized
   * page would have keyed, and a stale read has to be visible rather than
   * papered over by a correct-looking intent.
   */
  observed: LatLng[];
}

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const env = app.get<Env>(APP_ENV);

  const kv = app.get<KeyValueStore>(KV_STORE);
  // The same store `TrackingService` reads, so `awaitPing` confirms the ping at
  // the page's own source of truth rather than at a proxy for it.
  const locations = app.get<DriverLocationStore>(DRIVER_LOCATION_STORE);
  // The SAME instance the tracking page routes through — pass B's whole claim
  // rests on it being the same facade, cache and source, not merely a like one.
  const etaMaps = app.get<MapsProvider>(MAPS_PROVIDER_ETA);

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

    // ── the walk's own shape, before any of it is spent ───────────────────
    // `MINT_CELLS`/`MINT_POLLS_PER_CELL` are unvalidated env text, and the
    // DEGENERATE values are the dangerous ones. `MINT_CELLS=0` — or anything
    // non-numeric, which is `NaN` and passes every `>` comparison below —
    // walks no cells at all: the positive control lives inside the walk loop
    // and never fires, both assertion halves are satisfied by empty sets, and
    // the summary prints `reduction 0×` under `[observed]` above a green
    // `PASS`. A meaningless figure wearing an observation's tag is the exact
    // defect this instrument exists to close, so refuse it by name.
    for (const [name, value] of [
      ['MINT_CELLS', CELLS],
      ['MINT_POLLS_PER_CELL', POLLS_PER_CELL],
    ] as const) {
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(
          `refusing to run: ${name}=${process.env[name] ?? '(unset)'} resolved to ${value}, which is not a ` +
            `positive integer. A zero or NaN count walks nothing, skips the positive control, satisfies every ` +
            `assertion on an empty set and prints a 0× reduction as an observation.`,
        );
      }
    }

    // ── the poll budget, before spending any of it ────────────────────────
    // One counted view per poll and nothing else — `awaitPing` reads the store
    // directly and the summary is printed, not fetched. The `+ 1` is head-room
    // against the throttle, not a request the run makes.
    const plannedViews = CELLS * POLLS_PER_CELL;
    console.log(
      `poll budget: ${CELLS} cells × ${POLLS_PER_CELL} polls = ${plannedViews} views ` +
        `(+1 head-room) vs TRACKING_VIEW_MAX_PER_WINDOW=${TRACKING_VIEW_MAX_PER_WINDOW}` +
        ` per ${TRACKING_VIEW_WINDOW_SECONDS} s`,
    );
    if (plannedViews + 1 > TRACKING_VIEW_MAX_PER_WINDOW) {
      throw new Error(
        `refusing to run: ${CELLS} × ${POLLS_PER_CELL} + 1 = ${plannedViews + 1} views exceeds ` +
          `TRACKING_VIEW_MAX_PER_WINDOW=${TRACKING_VIEW_MAX_PER_WINDOW}; the run would 429 mid-walk ` +
          `and the zero counts would be the throttle, not the cache. Lower MINT_CELLS/MINT_POLLS_PER_CELL.`,
      );
    }

    // ── the jitter geometry, before any spend ─────────────────────────────
    // The grid must be COARSER than the corridor key, or `quantizeForEtaCache`
    // is an identity function and pass B would report the SAME count as pass A
    // — a 1× "reduction" printed as if it were a measurement. This is the claim
    // `notifications.policy.ts:34` makes in prose, checked here against a live
    // run and in CI by `notifications.policy.spec.ts`.
    if (TRACKING_ETA_GRID_DECIMALS >= COORD_PRECISION) {
      throw new Error(
        `refusing to run: TRACKING_ETA_GRID_DECIMALS=${TRACKING_ETA_GRID_DECIMALS} is not coarser than ` +
          `COORD_PRECISION=${COORD_PRECISION}, so quantizeForEtaCache cannot collapse two distinct corridor ` +
          `keys and is an identity function. Pass B would cost exactly what pass A cost and the run would ` +
          `print a 1× reduction as an observation.`,
      );
    }

    // Jitter must stay inside the cell, or a poll lands in a NEIGHBOURING cell,
    // pass A pays twice for one cell and `[1, 0, 0, 0, 0]` breaks.
    const maxSteps = Math.max(
      Math.abs(jitterSteps(0)),
      Math.abs(jitterSteps(POLLS_PER_CELL - 1)),
    );
    if (maxSteps > MAX_JITTER_STEPS) {
      throw new Error(
        `refusing to run: MINT_POLLS_PER_CELL=${POLLS_PER_CELL} needs ${maxSteps} jitter steps at its ` +
          `furthest (${(maxSteps * JITTER_STEP_DEG).toFixed(4)}°), past the ${(MAX_JITTER_STEPS * JITTER_STEP_DEG).toFixed(4)}° ` +
          `bound and near the ${HALF_CELL_DEG.toFixed(4)}° half-cell — polls would cross into the next cell and the ` +
          `per-cell counts would be 2, not 1. Max is ${MAX_JITTER_STEPS * 2 + 1} polls per cell.`,
      );
    }
    // `maxSteps` is the LARGEST MAGNITUDE, not a symmetric bound: an even
    // `POLLS_PER_CELL` gives a lopsided range (8 polls → −3…+4). The offsets
    // are printed beside it so the shape is read rather than inferred from a
    // `±` that would not be true.
    console.log(
      `jitter: furthest offset ${maxSteps} × ${JITTER_STEP_DEG.toFixed(4)}° of latitude = ` +
        `${(maxSteps * JITTER_STEP_DEG).toFixed(4)}° ≈ ${(maxSteps * JITTER_STEP_DEG * METERS_PER_DEGREE_LAT).toFixed(0)} m from the cell centre ` +
        `(bound ${(MAX_JITTER_STEPS * JITTER_STEP_DEG).toFixed(4)}°, half-cell ${HALF_CELL_DEG.toFixed(4)}°), ` +
        `offsets [${Array.from({ length: POLLS_PER_CELL }, (_, p) => jitterSteps(p)).join(', ')}] steps`,
    );

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
      rows.push(
        await walkCell(
          i,
          driverSocket,
          token,
          locations,
          env.DEFAULT_CITY_ID,
          driver.id,
        ),
      );
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

    // ── pass A is CLOSED before pass B opens ──────────────────────────────
    // Its count is frozen, its table is printed and its invariants are checked
    // while no pass-B call exists to contaminate them. `routeFetched` filters
    // the WHOLE capture buffer, so it is cumulative — after pass B it answers
    // 36, not 6. Ordering, not discipline, is what keeps the two passes' numbers
    // apart: every pass-A figure below is an argument, never a fresh read.
    const etaCallsQuantized = routeFetched('eta').length;
    const quoteCalls = routeFetched('quote').length;
    reportCells(rows);
    assertQuantizedInvariants(rows, etaCallsQuantized, quoteCalls);

    const unquantized = await unquantizedPass(etaMaps, kv, rows);
    // Exactly pass B's events: the split point is the frozen pass-A length, so
    // pass A's hashes cannot be counted into pass B's distinctness check.
    const passBEvents = routeFetched('eta').slice(etaCallsQuantized);
    reportSummary(rows, token, {
      quantized: etaCallsQuantized,
      unquantized,
      quoteCalls,
    });
    assertUnquantizedInvariants(rows, unquantized, passBEvents);
    console.log(
      '\nPASS — one paid route call per cell crossing under sub-cell jitter, ' +
        `and ${unquantized} without the grid.`,
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
 * Waits for THIS poll's ping to reach Redis. Costs no view, no throttle, no
 * paid call — it reads the same store `TrackingService` reads
 * (`tracking.service.ts:125`). Replaces the old landed-loop, which spent
 * counted views on the confirmation.
 *
 * Why it must precede the counted view: a view taken before the ping lands
 * routes the PREVIOUS poll's corridor. In pass A that is merely a cache hit and
 * `[1, 0, 0, 0, 0]` still passes — but in pass B it is a DUPLICATE corridor, and
 * the pass silently costs less than `CELLS × POLLS_PER_CELL`. The race is
 * therefore closed at the store rather than papered over with a longer sleep.
 */
async function awaitPing(
  locations: DriverLocationStore,
  cityId: string,
  driverId: string,
  expected: LatLng,
  what: string,
): Promise<void> {
  const deadline = Date.now() + PING_SETTLE_TIMEOUT_MS;
  for (;;) {
    await sleep(POLL_GAP_MS);
    const recorded = await locations.positionOf(cityId, driverId);
    if (
      recorded &&
      Math.abs(recorded.location.lat - expected.lat) <
        JITTER_MATCH_TOLERANCE_DEG
    ) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `${what}: the driver's recorded position never reached ${expected.lat} within ${PING_SETTLE_TIMEOUT_MS} ms — ` +
          `the location ping was dropped (Redis unreachable, or the driver left the online set). ` +
          `If this is intermittent, raise PING_SETTLE_TIMEOUT_MS.`,
      );
    }
  }
}

/**
 * One cell, one poll at a time: move to THIS poll's sub-cell offset, wait for
 * the ping to land, then take exactly one counted view — recording the
 * paid-call delta and the position the page reported.
 *
 * Every poll moves, which is what #108 changed. Under the old shape the cell
 * was emitted once and polled byte-identically, so `quantizeForEtaCache` was an
 * identity function and the zeros below belonged to the 4-dp corridor cache
 * rather than to #87's grid. Now each poll keys its own 4-dp corridor while
 * still quantizing to the one cell centre — so the zeros are the grid's, and
 * pass B has something to pay for.
 *
 * The cell's FIRST poll is still the one that pays: `awaitPing` spends no
 * views, so the first counted view of a fresh cell is a miss and the rest are
 * hits. That is what keeps `[1, 0, 0, 0, 0]` meaningful.
 */
async function walkCell(
  index: number,
  socket: Socket,
  token: string,
  locations: DriverLocationStore,
  cityId: string,
  driverId: string,
): Promise<CellRow> {
  const centre = cellLocation(index);
  const perView: number[] = [];
  const observed: LatLng[] = [];
  let cell: string | null = null;

  for (let poll = 0; poll < POLLS_PER_CELL; poll++) {
    const position = pollLocation(index, poll);

    // `handleLocation` never acks and never throws — a ping is fire-and-forget,
    // so unlike the spec's `moveDriver` there is no return value to assert on.
    // Read the position back from the store instead, or a silently dropped ping
    // shows up as a mysteriously missing route call several cells later.
    socket.emit(RT.driverLocation, {
      location: position,
      at: new Date().toISOString(),
    });
    await awaitPing(
      locations,
      cityId,
      driverId,
      position,
      `cell ${index} poll ${poll}`,
    );

    const before = routeFetched('eta');
    const page = await view(token);
    const after = routeFetched('eta');
    perView.push(after.length - before.length);
    const fresh = after[after.length - 1];
    if (after.length > before.length && typeof fresh?.['cell'] === 'string') {
      cell = fresh['cell'];
    }

    // The page-side check, kept as the diagnostic it has always been — but now
    // against THIS POLL's jittered latitude rather than the cell centre, which
    // makes it stronger: it proves the page shows *this* poll's position, not
    // merely *this* cell. The store settled above, so a mismatch here means the
    // page read something else entirely.
    if (page.position === null) {
      throw new Error(
        `cell ${index} poll ${poll}: the page showed no driver position at all — ` +
          `the ride left ACTIVE_DRIVER_RIDE_STATUSES, or the driver left the online set`,
      );
    }
    if (
      Math.abs(page.position.lat - position.lat) >= JITTER_MATCH_TOLERANCE_DEG
    ) {
      throw new Error(
        `cell ${index} poll ${poll}: the page showed the driver at ${page.position.lat}, not ${position.lat} — ` +
          `the store settled but the page read a different position, so this view keyed a corridor ` +
          `this poll never occupied and pass B would replay the wrong one`,
      );
    }
    observed.push({ lat: page.position.lat, lng: page.position.lng });
  }

  return {
    index,
    quantized: quantizeForEtaCache(centre),
    views: perView.length,
    perView,
    cell,
    observed,
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

// ───────────────────────────────── pass B ─────────────────────────────────

/**
 * PASS B — the unquantized counterfactual, RUN rather than derived.
 *
 * `TrackingService.roadEta` is exactly `maps.route(quantizeForEtaCache(from), target)`
 * (`tracking.service.ts:192`). This is that call with the wrapper removed, against
 * the SAME `MAPS_PROVIDER_ETA` instance, the same Redis, the same source and the
 * same target, replaying the positions pass A's page actually reported.
 * Substituting identity for `quantizeForEtaCache` is the ONLY difference between
 * the two counts — which is what makes the reduction attributable to #87's grid
 * rather than to the 4-dp corridor cache that predates it.
 *
 * It deliberately does NOT go through `GET /track/:token`: it measures the SEAM's
 * cost, which is where the paid call is, and so spends none of the token's poll
 * budget.
 */
async function unquantizedPass(
  maps: MapsProvider,
  kv: KeyValueStore,
  rows: CellRow[],
): Promise<number> {
  const positions = rows.flatMap((row) => row.observed);
  const keys = positions.map((p) =>
    routeCacheKey('eta', p, CENTRE_PICKUP.location),
  );

  // FAIL BEFORE SPENDING, not after. If two polls collapsed onto one corridor
  // (a ping landed late, or the jitter got rounded back onto the grid), pass B
  // costs one call fewer and the reduction reads BETTER than reality — the
  // flattering direction, and the one a reader will not question. Caught here it
  // names the cause; caught by the count assertion afterwards it has already
  // been paid for.
  const distinct = new Set(keys);
  if (distinct.size !== positions.length) {
    throw new Error(
      `refusing to run pass B: ${positions.length} polls collapsed onto ${distinct.size} distinct ` +
        `4-dp corridors. Either a ping landed late (two polls saw one position — raise ` +
        `PING_SETTLE_TIMEOUT_MS) or the jitter is being rounded onto the grid (check that ` +
        `pollLocation rounds to COORD_PRECISION, not TRACKING_ETA_GRID_DECIMALS). ` +
        `Pass B would under-report and the reduction would read too high.`,
    );
  }

  // Cold cache, exactly as pass A started from — and NOT optional: the
  // zero-offset poll of every cell renders to the same 4-dp key as pass A's
  // quantized origin, so without this those CELLS corridors are warm and pass B
  // under-reports by one per cell. Run 2 of the idempotence check is worse:
  // inside MAPS_ETA_CACHE_TTL_SECONDS every corridor is warm and pass B reports
  // ~0.
  //
  // Built from `row.observed` — what the page reported — rather than from
  // `pollLocation`. The two agree here (Redis GEO's ~0.6 m error is ~5.4e-6°,
  // far inside the 5e-5° a 4-dp rendering would need to move), but clearing
  // exactly what you are about to route is the version that cannot drift.
  for (const position of positions) {
    await kv.del(routeCacheKey('eta', position, CENTRE_PICKUP.location));
    await kv.del(routeFailureKey('eta', position, CENTRE_PICKUP.location));
  }

  // WHY THE NEXT RUN SURVIVES THIS, since it is not obvious: pass B leaves
  // `CELLS × POLLS_PER_CELL` warm corridors for MAPS_ETA_CACHE_TTL_SECONDS. Run
  // 2's pass-A pre-flight clears the quantized cell centres, which is exactly
  // the one key per cell that pass B's zero-offset poll shares; every other
  // entry sits at a 4-dp offset pass A never keys. So run 2's pass A is cold,
  // and its pass B re-clears its own.
  const before = routeFetched('eta').length;
  for (const position of positions) {
    // Deliberately NOT wrapped in a catch. A throw here means the source failed
    // or the seam timed out, and swallowing it would leave pass B short by one
    // and blame the cache. The `finally` teardown still runs. (`eta`
    // negative-caches, so a swallowed failure would also poison that corridor
    // for MAPS_ETA_FAILURE_TTL_SECONDS and quietly corrupt the NEXT run.)
    await maps.route(position, CENTRE_PICKUP.location);
  }
  return routeFetched('eta').length - before;
}

// ──────────────────────────── report & assertions ─────────────────────────

/**
 * Pass A's table, printed BEFORE pass A is asserted — so a failing run still
 * shows the rows that explain why. Split out of the old `report()` for exactly
 * that reason: the assertions moved earlier (ahead of pass B), and the table had
 * to move with them.
 */
function reportCells(rows: CellRow[]): void {
  console.log('\n── per cell ─────────────────────────────────────────────');
  console.log(
    '  #   quantized origin        cell        views  eta calls per view  observed offset (steps)',
  );
  for (const row of rows) {
    const origin = `${row.quantized.lat.toFixed(3)},${row.quantized.lng.toFixed(3)}`;
    // The OBSERVED offset, not the intended one — same reason pass B replays
    // observed positions. A stale read is then visible in this column rather
    // than hidden behind a correct-looking intent. (`awaitPing` throws before
    // such a row can print; this is what makes that verifiable, not assumed.)
    const offsets = row.observed
      .map((p) => Math.round((p.lat - row.quantized.lat) / JITTER_STEP_DEG))
      .map((n) => (n > 0 ? `+${n}` : String(n)))
      .join(', ');
    console.log(
      `  ${String(row.index).padStart(2)}  ${origin.padEnd(22)} ${(row.cell ?? '—').padEnd(11)} ` +
        `${String(row.views).padStart(5)}  [${row.perView.join(', ')}]${' '.repeat(Math.max(1, 18 - row.perView.join(', ').length))}[${offsets}]`,
    );
  }
}

function reportSummary(
  rows: CellRow[],
  token: string,
  counts: { quantized: number; unquantized: number; quoteCalls: number },
): void {
  const totalViews = rows.reduce((sum, r) => sum + r.views, 0);
  // Both eta counts arrive as ARGUMENTS. `routeFetched('eta')` is cumulative and
  // this function runs after pass B, so a fresh read here would print 36 as pass
  // A's cost — the exact defect class this instrument exists to close.
  const etaCalls = counts.quantized;
  const quoteCalls = counts.quoteCalls;
  const reduction = counts.unquantized / Math.max(1, etaCalls);
  // `.toFixed(0)` only when it really is integral: rounding a 4.8× to "5×" is
  // the same class of claim this ticket is retiring.
  const reductionText = Number.isInteger(reduction)
    ? `${reduction.toFixed(0)}×`
    : `${reduction.toFixed(2)}×`;
  const maxSteps = Math.max(
    Math.abs(jitterSteps(0)),
    Math.abs(jitterSteps(POLLS_PER_CELL - 1)),
  );
  const jitterDeg = maxSteps * JITTER_STEP_DEG;
  const offsetsUsed = Array.from({ length: POLLS_PER_CELL }, (_, p) =>
    jitterSteps(p),
  ).join(', ');

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

  // THE HEADLINE. The tags are the deliverable, not decoration, and they are
  // NOT all the same tag: the two counts are `observed` — a pass produced each —
  // while the ratio is `derived`, being arithmetic on them. Printing the ratio
  // as `[observed]` would be the #107 defect in miniature, a figure no run
  // emitted wearing a run's tag.
  //
  // The counts are also printed SEPARATELY from what they were expected to be.
  // This function runs BEFORE `assertUnquantizedInvariants`, so a short pass B
  // would otherwise print `29 = 6 cells × 5 polls` — a false equation, tagged
  // `[observed]`, above the assertion that catches it.
  const expectedUnquantized = rows.length * POLLS_PER_CELL;
  // The attribution is EARNED, not automatic: it holds only while the two passes
  // are different experiments. At one poll per cell there is no jitter
  // (`jitterSteps(0) = 0`), both passes key the identical corridor set, and the
  // 1× is an identity rather than a measurement of the grid. So the clause is
  // withheld at N < 2 rather than printed and then contradicted underneath.
  const measures = POLLS_PER_CELL >= 2;
  console.log(
    `\nquantized cost              ${etaCalls} paid calls, one per cell crossing            [observed — pass A]\n` +
      `unquantized cost           ${String(counts.unquantized).padStart(2)} paid calls, one per 4-dp corridor            [observed — pass B]\n` +
      `                              expected ${rows.length} cells × ${POLLS_PER_CELL} polls = ${expectedUnquantized}                  [derived — asserted below]\n` +
      `reduction                   ${reductionText} = ${counts.unquantized} ÷ ${etaCalls}` +
      (measures
        ? `, attributable to #87's ETA grid  [derived — pass B ÷ pass A]`
        : `  [derived — pass B ÷ pass A], and NOT attributable to anything`),
  );
  if (!measures) {
    console.log(
      `                            MINT_POLLS_PER_CELL=${POLLS_PER_CELL} means zero jitter, so both passes key the identical\n` +
        `                            corridor set and this ratio is an identity, not a measurement of the grid.\n` +
        `                            A measurement needs ≥2 polls per cell; this run is a smoke test.`,
    );
  }
  console.log(
    `\nProvenance. Pass B replays the raw positions pass A's page reported, through the SAME\n` +
      '`MAPS_PROVIDER_ETA` instance, the same Redis, the same `MAPS_PROVIDER_SOURCE` and the same\n' +
      'pickup target, with `quantizeForEtaCache` replaced by identity. That substitution is the\n' +
      'ONLY difference between the two counts, which is what attributes the reduction to the grid\n' +
      "rather than to `CachingMapsProvider`'s 4-dp corridor cache (which predates it). Both passes\n" +
      'start from a cold cache — the corridors are cleared immediately before each. Pass B does not\n' +
      "go through `GET /track/:token`: it measures the seam's cost, where the paid call is.",
  );
  console.log(
    `\nJitter: furthest offset ${maxSteps} steps × ${JITTER_STEP_DEG.toFixed(4)}° of LATITUDE = ${jitterDeg.toFixed(4)}° ≈ ${(jitterDeg * METERS_PER_DEGREE_LAT).toFixed(0)} m ` +
      `(${jitterDeg.toFixed(4)} × ${METERS_PER_DEGREE_LAT} m/°); the same\n` +
      `figure would be ~${(jitterDeg * METERS_PER_DEGREE_LAT * Math.cos((CENTRE_PICKUP.location.lat * Math.PI) / 180)).toFixed(0)} m of longitude at Rīga's ~57°N, and this jitter is latitude. Deterministic,\n` +
      `not random — two runs walk identical coordinates. Offsets [${offsetsUsed}] steps — the furthest is a\n` +
      `MAGNITUDE, not a symmetric bound (an even poll count is lopsided). Inside the ${(MAX_JITTER_STEPS * JITTER_STEP_DEG).toFixed(4)}° bound and\n` +
      `inside the ${HALF_CELL_DEG.toFixed(4)}° half-cell, so every poll quantizes to its own cell centre (asserted).`,
  );
  console.log(
    `\nAgainst StubMapsProvider pass B is free. If a real Google provider is ever bound in dev, one\n` +
      `run of this script is ${etaCalls + counts.unquantized + quoteCalls} paid route calls (${etaCalls} eta pass A + ${counts.unquantized} eta pass B + ${quoteCalls} quote from\n` +
      `POST /rides pricing — the quote counts too, it is the same seam), not ${etaCalls}. The <€100/mo guardrail\n` +
      'is the reason this instrument exists, and pass B is the part of it that costs the most.',
  );
  console.log(
    `\nThe reduction scales with polls per cell and is NOT a per-minute spend figure: it is the cost\n` +
      `of THIS walk (${totalViews} views) under THIS dwell. \`notifications.policy.ts:41-46\` has the moving-driver\n` +
      'case (~2× at 12 polls/min over a uniform heading); the stationary driver — the case the grid\n' +
      'really rescues — is the one this run resembles.',
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

/**
 * Pass A's half, called BEFORE `unquantizedPass` exists to contaminate it. The
 * counts arrive as arguments rather than being re-read: `routeFetched` is
 * cumulative, and the split is what makes a cross-pass read impossible rather
 * than merely discouraged.
 */
function assertQuantizedInvariants(
  rows: CellRow[],
  etaCalls: number,
  quoteCalls: number,
): void {
  const problems: string[] = [];

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

  // TRAP 3, ASSERTED RATHER THAN ASSUMED. This is the single check that keeps
  // `[1, 0, 0, 0, 0]` meaningful under jitter, and the one that fails first if
  // the jitter ever grows past the half-cell: every position the page reported
  // must still quantize to ITS OWN cell centre.
  for (const row of rows) {
    for (const [poll, position] of row.observed.entries()) {
      const snapped = quantizeForEtaCache(position);
      if (
        snapped.lat !== row.quantized.lat ||
        snapped.lng !== row.quantized.lng
      ) {
        problems.push(
          `cell ${row.index} poll ${poll}: observed ${position.lat},${position.lng} quantizes to ` +
            `${snapped.lat},${snapped.lng}, not this cell's ${row.quantized.lat},${row.quantized.lng} — ` +
            `the jitter crossed the cell boundary and this cell is being paid for twice`,
        );
      }
    }
    // Pass B replays this array, so a hole in it silently shrinks pass B.
    if (row.observed.length !== POLLS_PER_CELL) {
      problems.push(
        `cell ${row.index}: recorded ${row.observed.length} observed positions, expected ${POLLS_PER_CELL} — ` +
          `pass B replays this array and would be short by ${POLLS_PER_CELL - row.observed.length}`,
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(`FAILED:\n  - ${problems.join('\n  - ')}`);
  }
}

/**
 * Pass B's half. `passBEvents` is `routeFetched('eta').slice(etaCallsQuantized)`
 * — pass A's hashes are sliced off, so nothing here can count them in.
 */
function assertUnquantizedInvariants(
  rows: CellRow[],
  unquantized: number,
  passBEvents: Record<string, unknown>[],
): void {
  const problems: string[] = [];
  const expected = rows.length * POLLS_PER_CELL;

  if (unquantized !== expected) {
    problems.push(
      `expected ${expected} paid pass-B calls (${rows.length} cells × ${POLLS_PER_CELL} polls), counted ${unquantized} — ` +
        (unquantized < expected
          ? `FEWER means warm corridors (the pass-B clear missed one) or duplicate observed positions ` +
            `(a ping landed late — raise PING_SETTLE_TIMEOUT_MS)`
          : `MORE means the target or the key builder drifted from \`roadEta\`'s`),
    );
  }

  // The corridor-level version of the count above: it is what proves the jitter
  // actually minted distinct keys rather than pass B paying twice for one.
  //
  // Read from the `cell` hashes THE PROVIDER EMITTED (`cellOf(key)`), NOT
  // recomputed script-side. A script-side recomputation only proves the script
  // agrees with itself and would pass even if the facade keyed something else;
  // the emitted hash is an observation of what was actually keyed, which is the
  // entire point of this ticket.
  const passBCells = new Set(
    passBEvents
      .map((e) => e['cell'])
      .filter((c): c is string => typeof c === 'string'),
  );
  if (passBCells.size !== expected) {
    problems.push(
      `expected ${expected} distinct pass-B \`cell\` hashes, saw ${passBCells.size} — ` +
        `the jitter did not mint one corridor per poll`,
    );
  }

  // THE WRONG-TARGET DETECTOR. Exactly one poll per cell has a zero jitter
  // offset (`jitterSteps(p) = 0` at `p = floor((N−1)/2)`, a valid index for
  // every POLLS_PER_CELL ≥ 1), and that poll's raw position renders to the same
  // 4-dp key text as pass A's quantized origin for that cell — so the two passes
  // must share exactly `rows.length` hashes. If they share none, pass B is
  // routing a different corridor space than the page did: wrong `to`, wrong
  // `caller` namespace, or a key builder that drifted. Without this, pass B can
  // be perfectly self-consistent and still measure something the page never
  // keyed — and it would print as `[observed]`.
  //
  // It does NOT cover a drifted `routeCacheKey`: both passes would drift
  // together and this check would still pass. That case is held by the key
  // builder's own callers. It is also VACUOUS at POLLS_PER_CELL = 1, where both
  // passes key the identical corridor set.
  const missing = rows
    .filter((row) => row.cell !== null && !passBCells.has(row.cell))
    .map((row) => row.index);
  if (missing.length > 0) {
    problems.push(
      `pass A's \`cell\` hash for cell(s) ${missing.join(', ')} does not appear among pass B's — ` +
        `pass B routed a corridor space the page never keyed (wrong \`to\`, wrong \`caller\` namespace, ` +
        `or a key builder that drifted from \`roadEta\`'s)`,
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
    // behind them is the ghost presence `markOfflineByServer` exists to
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
