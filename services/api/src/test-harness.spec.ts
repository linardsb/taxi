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

  it('releases the bound socket when the boot throws after listen() (failure)', async () => {
    // The #208 window: the listen and the `DRIZZLE` resolution used to sit
    // OUTSIDE the harness's `try`, so a throw from either escaped with `ctx`
    // unassigned and the socket still bound — nothing left to close it, and a
    // bound socket alone held jest open (#194 review F1). This drives that
    // shape from a spec: `configure` lets the real listen bind, then throws in
    // its place. The assertion is the socket's, not the adapter's — the
    // Redis-gated cases in `redis-io.adapter.spec.ts` cover the clients.
    let bound: Server | undefined;
    let listeningAtThrow: boolean | undefined;

    await expect(
      createTestApp({
        configure: (app) => {
          const listen = app.listen.bind(app);
          // `listen` is overloaded — (port[, host][, cb]) — and no single
          // stand-in signature satisfies both arms, so the replacement is
          // typed by the call the harness actually makes and cast back.
          app.listen = (async (port: number, host: string) => {
            await listen(port, host);
            bound = app.getHttpServer() as Server;
            listeningAtThrow = bound.listening;
            throw new Error('probe: the boot threw after listen()');
          }) as unknown as typeof app.listen;
          return Promise.resolve();
        },
      }),
    ).rejects.toThrow('probe: the boot threw after listen()');

    // Recorded rather than asserted inside the callback: an expect() that
    // throws in there is caught by the harness and re-emerges as the boot
    // error, which would make this case fail for the wrong reason.
    expect(listeningAtThrow).toBe(true); // the bind really happened
    expect(bound!.listening).toBe(false); // …and the catch released it
    expect(bound!.address()).toBeNull();
  });

  it('rethrows the boot error when the teardown path throws too (failure)', async () => {
    // The harness's masking guarantee: "anything thrown by the teardown path —
    // `close()` or the `configure` teardown — is printed and the ORIGINAL is
    // rethrown". Both `catch` blocks were unexecuted by the suite before this
    // case (#209 review L3), so the guarantee was prose only. Ungated, not
    // Redis-gated: a throwing teardown needs no adapter and no clients, and
    // the point is that these lines run on EVERY suite run.
    const BOOM = 'probe: boot failed';
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(
        createTestApp({
          configure: (app) => {
            app.init = () => Promise.reject(new Error(BOOM));
            // Wrapped, not replaced: the real close still runs, so the app
            // this case abandons holds nothing open. A stubbed-out close
            // would test the guarantee by leaking the thing the guarantee
            // exists to release.
            const close = app.close.bind(app);
            app.close = async () => {
              await close();
              throw new Error('probe: close boom');
            };
            return Promise.resolve(() =>
              Promise.reject(new Error('probe: teardown boom')),
            );
          },
        }),
      ).rejects.toThrow(BOOM); // …not either teardown error

      // `console.error(message?: any, ...rest: any[])`, so both columns are
      // `any` at the call site and have to be narrowed before asserting.
      const printed = errors.mock.calls as [string, Error][];
      expect(printed.map(([message]) => message)).toEqual([
        'createTestApp: app.close() after a failed boot threw (the original error follows)',
        'createTestApp: the configure teardown after a failed boot threw (the original error follows)',
      ]);
      // Both printed the error they caught, not the boot error.
      expect(printed.map(([, caught]) => caught.message)).toEqual([
        'probe: close boom',
        'probe: teardown boom',
      ]);
    } finally {
      errors.mockRestore();
    }
  });
});
