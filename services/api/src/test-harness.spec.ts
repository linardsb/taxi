import type { AddressInfo, Server } from 'node:net';
import { createServer } from 'node:http';
import request from 'supertest';
import { createTestApp, type TestApp } from '../test/harness';

/**
 * The network invariants of `createTestApp` (#193).
 *
 * The defect these guard: an app that had `init()` but never `listen()` makes
 * supertest bind the server itself, once per REQUEST — 630 ephemeral binds per
 * suite run (`observed`, the #193 RCA) where listening once costs one per app
 * built — and each of those binds took the WILDCARD address,
 * where a foreign `127.0.0.1` listener inside the ephemeral range wins the
 * routing and answers the test's request. Observed outcomes were a reset, a
 * 20 s stall into a jest that would not exit, and `Parse Error: Expected
 * HTTP/, RTSP/ or ICE/` — an unrelated desktop process replying in its own
 * protocol.
 *
 * Neither half regresses loudly on its own: a spec that skips `listen` still
 * passes, most of the time. Hence assertions rather than a colour.
 */
describe('createTestApp network invariants (#193)', () => {
  let ctx: TestApp;
  let server: Server;

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  /** Each bind emits `listening` on the very server supertest would re-bind. */
  function countBinds(): { stop: () => number } {
    let binds = 0;
    const onListening = (): void => {
      binds += 1;
    };
    server.on('listening', onListening);
    return {
      stop: () => {
        server.off('listening', onListening);
        return binds;
      },
    };
  }

  it('serves requests off the harness bind — supertest never re-binds (expected)', async () => {
    // Pins "0 binds" to "already listening". Without it a future harness whose
    // getHttpServer() returned a DIFFERENT object from the one supertest
    // re-binds would read 0 here and pass vacuously — the same trap as patching
    // the prototype, arrived at from the other side.
    expect(server.listening).toBe(true);

    const counter = countBinds();
    const http = request(server);
    await http.get('/health').expect(200);
    await http.get('/health').expect(200);
    await http.get('/health').expect(200);

    // The old behaviour was one bind per request, so this would be 3.
    expect(counter.stop()).toBe(0);
  });

  it('binds the loopback specifically, not the wildcard (edge)', () => {
    // `0.0.0.0` or `::` here means `listen(0)` lost its host argument: the bind
    // would then succeed over a foreign 127.0.0.1 listener and silently lose
    // the traffic to it. A loopback-specific bind either wins or EADDRINUSEs.
    expect(server.address()).toMatchObject({
      address: '127.0.0.1',
      family: 'IPv4',
    });
    expect((server.address() as AddressInfo).port).toBeGreaterThan(0);
  });

  it('counts the binds a non-listening server takes — one per request (failure)', async () => {
    // The control. Without it the assertion above could be vacuous: a counter
    // that never fires reads the same as a harness that binds once. This is
    // exactly what the nine never-listening integration specs did before the fix.
    //
    // This case is itself the hazardous path, by construction: it takes 2
    // WILDCARD ephemeral binds per run — the only ones left in the api suite,
    // against the 630 the fix removes. You cannot demonstrate per-request
    // binding without letting a bind happen. If this case ever reddens with
    // `Parse Error: Expected HTTP/, RTSP/ or ICE/`, it is those two binds
    // meeting a foreign 127.0.0.1 listener, not a return of #193.
    const bare = createServer((_req, res) => {
      res.statusCode = 204;
      res.end();
    });
    let binds = 0;
    bare.on('listening', () => {
      binds += 1;
    });

    await request(bare).get('/').expect(204);
    await request(bare).get('/').expect(204);

    expect(binds).toBe(2);
    expect(bare.listening).toBe(false); // supertest closed it again each time
  });
});
