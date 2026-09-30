import { Logger } from '@nestjs/common';
import { InMemoryKeyValueStore } from '../../../test/harness';
import { CachingMapsProvider } from './caching-maps.provider';
import { MAX_SNAP_METERS, OsrmMapsProvider } from './osrm-maps.provider';
import { StubMapsProvider } from './stub-maps.provider';

const CENTRE = { lat: 56.9496, lng: 24.1052 };
const STATION = { lat: 56.9467, lng: 24.1207 };
const RIX = { lat: 56.9236, lng: 23.9711 };

/** Digits of any coordinate above — none may appear in an error or a log. */
const COORDINATE_TEXT = /56\.9|24\.1|23\.9/;

function jsonResponse(body: unknown, status = 200): Response {
  return { status, json: () => Promise.resolve(body) } as Response;
}

const ok = (
  distance = 5486.2,
  duration = 591.1,
  snaps: number[] = [3.2, 4.1],
) => ({
  code: 'Ok',
  routes: [{ distance, duration, geometry: '_p~iF~ps|U_ulLnnqC' }],
  waypoints: snaps.map((d) => ({ distance: d, location: [0, 0] })),
});

describe('OsrmMapsProvider', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  const stub = (response: Response) => {
    fetchMock = jest.fn().mockResolvedValue(response);
    global.fetch = fetchMock;
  };

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('asks for lng,lat in order and rounds to the seam’s integers (expected)', async () => {
    stub(jsonResponse(ok()));
    const osrm = new OsrmMapsProvider('http://osrm:5000/', 3_000);

    const route = await osrm.route(CENTRE, RIX, [STATION]);

    expect(route).toEqual({
      distanceMeters: 5486,
      durationSeconds: 591,
      polyline: '_p~iF~ps|U_ulLnnqC',
    });
    const url = (fetchMock.mock.calls as [[string]])[0][0];
    // Trailing slash on the base collapsed; longitude FIRST; stops in order.
    expect(url).toMatch(
      /^http:\/\/osrm:5000\/route\/v1\/driving\/24\.1052,56\.9496;24\.1207,56\.9467;23\.9711,56\.9236\?/,
    );
    expect(url).toContain('geometries=polyline');
  });

  it('refuses a point OSRM had to drag more than MAX_SNAP_METERS to a road (edge)', async () => {
    // Observed against the real Latvia graph: 0,0 snaps ~6 540 km and OSRM
    // answers Ok with distance 0 — a free ride, priced silently.
    stub(jsonResponse(ok(0, 0, [3, MAX_SNAP_METERS + 1])));
    const osrm = new OsrmMapsProvider('http://osrm:5000', 3_000);

    await expect(osrm.route(CENTRE, RIX)).rejects.toMatchObject({
      name: 'OsrmOffNetwork',
      message: 'maps_osrm_off_network',
    });
  });

  it('accepts a snap of exactly MAX_SNAP_METERS (edge)', async () => {
    stub(jsonResponse(ok(1200, 180, [MAX_SNAP_METERS, 0])));
    const osrm = new OsrmMapsProvider('http://osrm:5000', 3_000);

    await expect(osrm.route(CENTRE, RIX)).resolves.toMatchObject({
      distanceMeters: 1200,
    });
  });

  it.each([
    [
      'a 400 NoRoute',
      jsonResponse(
        { code: 'NoRoute', message: 'Impossible route 24.1,56.9' },
        400,
      ),
      'OsrmNoRoute',
    ],
    [
      'a 400 NoSegment',
      jsonResponse({ code: 'NoSegment', message: 'near 24.1052,56.9496' }, 400),
      'OsrmNoRoute',
    ],
    ['a 503', jsonResponse({}, 503), 'OsrmUnavailable'],
    [
      'an Ok with no routes',
      jsonResponse({ code: 'Ok', routes: [], waypoints: [] }),
      'OsrmContractViolation',
    ],
    [
      'a 400 InvalidQuery',
      jsonResponse(
        { code: 'InvalidQuery', message: 'malformed close to 24.1' },
        400,
      ),
      'OsrmContractViolation',
    ],
  ])(
    'maps %s to a named, coordinate-free error (failure)',
    async (_label, response, name) => {
      stub(response);
      const osrm = new OsrmMapsProvider('http://osrm:5000', 3_000);

      const error = (await osrm
        .route(CENTRE, RIX)
        .catch((e: unknown) => e)) as Error;

      expect(error.name).toBe(name);
      // OSRM's own message quotes the query — it must never be carried on.
      expect(error.message).not.toMatch(COORDINATE_TEXT);
      expect(error).not.toHaveProperty('cause');
    },
  );

  it('drops a network error whose text carries the URL (failure)', async () => {
    fetchMock = jest
      .fn()
      .mockRejectedValue(
        new TypeError(
          'fetch failed: http://osrm:5000/route/v1/driving/24.1052,56.9496',
        ),
      );
    global.fetch = fetchMock;
    const osrm = new OsrmMapsProvider('http://osrm:5000', 3_000);

    await expect(osrm.route(CENTRE, RIX)).rejects.toMatchObject({
      name: 'OsrmUnavailable',
      message: 'maps_osrm_unavailable',
    });
  });

  it('aborts the request itself at the timeout, not just the caller (failure)', async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    global.fetch = jest.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          signal = init!.signal!;
          signal.addEventListener('abort', () => {
            const abort = new Error('aborted');
            abort.name = 'AbortError';
            reject(abort);
          });
        }),
    );
    const osrm = new OsrmMapsProvider('http://osrm:5000', 250);

    const pending = osrm.route(CENTRE, RIX);
    jest.advanceTimersByTime(250);

    await expect(pending).rejects.toMatchObject({ name: 'OsrmTimeout' });
    expect(signal!.aborted).toBe(true);
  });

  it('keeps geo.maps.route_failed a closed enum with no coordinates behind the facade (failure)', async () => {
    // The whole taxonomy lives in `CachingMapsProvider`; this pins that
    // OSRM's failures reach it as `source_rejected` with a name that says
    // which failure, and nothing that locates a rider.
    stub(
      jsonResponse(
        { code: 'NoRoute', message: 'Impossible route 24.1052,56.9496' },
        400,
      ),
    );
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const osrm = new OsrmMapsProvider('http://osrm:5000', 3_000);
    const facade = new CachingMapsProvider(
      Object.assign(new StubMapsProvider(), {
        route: osrm.route.bind(osrm),
      }),
      new InMemoryKeyValueStore(),
      'eta',
      300,
      60,
      3_000,
      2_592_000,
    );

    await expect(facade.route(CENTRE, RIX)).rejects.toThrow(
      'maps_osrm_no_route',
    );

    const payload = warn.mock.calls
      .map(([p]) => p as Record<string, unknown>)
      .find((p) => p.event === 'geo.maps.route_failed');
    expect(payload).toMatchObject({
      reason: 'source_rejected',
      errorName: 'OsrmNoRoute',
    });
    expect(JSON.stringify(payload)).not.toMatch(COORDINATE_TEXT);
  });
});
