/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-this-alias */
/**
 * #193 investigation instrument. NOT shipped source — runs in `setupFiles`
 * (per spec file, before the framework) and only records.
 *
 * PATCHES ONCE PER PROCESS. `setupFiles` run again for every spec file and
 * `net.Server.prototype` is process-global, so an unguarded wrapper stacks:
 * with 76 files one real bind gets written 76 times. Worse, jest gives every
 * spec file its own COPY of process.env, so each stacked layer reports a
 * different spec name for the same event — which is how the first cut of this
 * probe manufactured "629 ports bound by more than one spec file". The guard
 * lives on the shared function object, the only thing every sandbox agrees on.
 *
 * No event carries a spec name. Events are timestamped and the probe
 * ENVIRONMENT brackets each file with start/end records, so attribution is by
 * interval at analysis time, where module scope cannot fake it.
 *
 * Ledgers: `listen`/`srv-close` (every ephemeral port supertest binds and
 * releases), `reuse` (http.Agent.reuseSocket — a request served by a socket
 * already in the process-global keep-alive pool), `cerr` (client request
 * errors, with the port and whether the socket came from that pool).
 */
const fs = require('node:fs');
const http: any = require('node:http');
const net: any = require('node:net');

const LOG = process.env.SPEC_PROBE_LOG;
const GUARD = '__spec_probe_193__';

if (LOG && !net.Server.prototype.listen[GUARD]) {
  const write = (record: Record<string, unknown>): void => {
    try {
      fs.appendFileSync(
        LOG,
        `${JSON.stringify({ ...record, t: Date.now() })}\n`,
      );
    } catch {
      /* the probe must never fail a run */
    }
  };

  const realListen = net.Server.prototype.listen;
  const patchedListen = function (this: any, ...args: unknown[]) {
    const out = realListen.apply(this, args);
    const addr = this.address();
    if (addr && typeof addr === 'object') {
      write({ ev: 'listen', port: addr.port });
    }
    return out;
  };
  patchedListen[GUARD] = true;
  net.Server.prototype.listen = patchedListen;

  const realClose = net.Server.prototype.close;
  net.Server.prototype.close = function (this: any, ...args: unknown[]) {
    const addr = this.address();
    write({
      ev: 'srv-close',
      port: addr && typeof addr === 'object' ? addr.port : null,
    });
    return realClose.apply(this, args);
  };

  const realReuse = http.Agent.prototype.reuseSocket;
  if (typeof realReuse === 'function') {
    http.Agent.prototype.reuseSocket = function (
      this: any,
      socket: any,
      req: any,
    ) {
      write({
        ev: 'reuse',
        port: socket.remotePort,
        path: req.path,
        destroyed: socket.destroyed,
        writable: socket.writable,
      });
      return realReuse.call(this, socket, req);
    };
  }

  const realOnSocket = http.ClientRequest.prototype.onSocket;
  http.ClientRequest.prototype.onSocket = function (
    this: any,
    socket: any,
    ...rest: unknown[]
  ) {
    const req = this;
    req.once('error', (err: NodeJS.ErrnoException) => {
      write({
        ev: 'cerr',
        msg: err.message,
        code: err.code,
        path: req.path,
        port: socket?.remotePort ?? null,
        reused: req.reusedSocket === true,
      });
    });
    return realOnSocket.call(this, socket, ...rest);
  };
}
