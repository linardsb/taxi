/**
 * #193 investigation instrument. NOT shipped source — a jest testEnvironment
 * that delegates entirely to jest-environment-node and only records.
 *
 * Two facts per spec file, appended as one JSON line each to $SPEC_PROBE_LOG:
 *  - order: the sequence jest actually ran the files in (pid included, so
 *    "maxWorkers: 1 runs in band" is observed rather than assumed)
 *  - handles: process-global handles alive at this file's teardown that were
 *    NOT alive at the previous file's teardown — i.e. what this file left
 *    behind for the next one. In band, the handle table is shared, so a
 *    leaked server/socket is attributable to the file after which it appears.
 */
const { TestEnvironment: NodeEnvironment } = require('jest-environment-node');
const { appendFileSync } = require('node:fs');

const LOG = process.env.SPEC_PROBE_LOG;

/** Handles seen at the previous file's teardown, by identity. */
const seen = new WeakSet();

function write(record) {
  if (!LOG) return;
  try {
    appendFileSync(LOG, `${JSON.stringify(record)}\n`);
  } catch {
    /* the probe must never fail a run */
  }
}

function describeHandle(h) {
  const kind = h?.constructor?.name ?? typeof h;
  const out = { kind };
  try {
    if (typeof h.address === 'function') {
      const a = h.address();
      if (a && typeof a === 'object') out.listening = `${a.address}:${a.port}`;
    }
    if (typeof h.localPort === 'number') out.local = h.localPort;
    if (h.remoteAddress) out.remote = `${h.remoteAddress}:${h.remotePort}`;
    if (kind === 'Timeout') {
      out.ms = h._idleTimeout;
      out.repeat = h._repeat === true || typeof h._repeat === 'number';
      const fn = h._onTimeout;
      if (fn && fn.name) out.fn = fn.name;
    }
    if (typeof h.fd === 'number') out.fd = h.fd;
  } catch {
    /* best effort */
  }
  return out;
}

function activeHandles() {
  if (typeof process._getActiveHandles === 'function') {
    return process._getActiveHandles();
  }
  return [];
}

/** http.globalAgent is a PROCESS global: in band it is shared by every spec. */
function agentState() {
  try {
    const http = require('node:http');
    const snap = (bucket) =>
      Object.fromEntries(
        Object.entries(bucket || {}).map(([k, v]) => [k, v.length]),
      );
    return {
      keepAlive: http.globalAgent.keepAlive,
      free: snap(http.globalAgent.freeSockets),
      active: snap(http.globalAgent.sockets),
    };
  } catch {
    return null;
  }
}

class SpecProbeEnvironment extends NodeEnvironment {
  constructor(config, context) {
    super(config, context);
    this.specPath = context.testPath;
    this.started = Date.now();
    // setupFiles run BEFORE environment.setup() (observed), so a sandbox global
    // set there is too late. Stamp it in the constructor and mirror it on the
    // real process env, which the in-band setupFiles read directly.
    this.global.__SPEC_PROBE__ = { spec: this.specPath, log: LOG };
    process.env.SPEC_PROBE_SPEC = this.specPath;
  }

  async setup() {
    await super.setup();
    write({
      ev: 'start',
      pid: process.pid,
      t: Date.now(),
      iso: new Date().toISOString(),
      spec: this.specPath,
    });
  }

  async teardown() {
    // Snapshot BEFORE super.teardown() so the file's own context is still up.
    const handles = activeHandles();
    const fresh = [];
    for (const h of handles) {
      if (seen.has(h)) continue;
      seen.add(h);
      fresh.push(describeHandle(h));
    }
    write({
      ev: 'end',
      pid: process.pid,
      t: Date.now(),
      iso: new Date().toISOString(),
      ms: Date.now() - this.started,
      spec: this.specPath,
      liveTotal: handles.length,
      leftBehind: fresh,
      agent: agentState(),
    });
    await super.teardown();
  }
}

module.exports = SpecProbeEnvironment;
module.exports.TestEnvironment = SpecProbeEnvironment;
module.exports.default = SpecProbeEnvironment;
