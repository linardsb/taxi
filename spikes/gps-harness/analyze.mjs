#!/usr/bin/env node
// Throwaway analyzer for spike #4 — Expo background GPS field test.
// Not production code: zero dependencies, bare Node >= 18, hardcoded thresholds.
// Thresholds mirror the "Pass/fail" table in docs/spikes/04-gps-field-test.md.
//
//   node analyze.mjs data/android-default.jsonl [more.jsonl...]
//   node analyze.mjs --selftest
//
// Input: the harness's fixes.jsonl — one {ts, recvTs, lat, lng, acc, speed, battery}
// per line. Gap metrics come from `ts` (GPS time); batching from `recvTs` (JS task
// receive time). The two are never mixed.
//
// The one piece of real logic: the harness runs with distanceInterval: 10, so a
// stationary phone (red light) legitimately produces no fixes. A gap A->B counts as
// MOVING only if haversine(A, B) >= 15 m or either bounding speed >= 1.5 m/s —
// only MOVING gaps are gated. The unfiltered distribution is always printed next
// to it so a suspicious filter is visible.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const USAGE = `Usage: node analyze.mjs <run.jsonl> [more.jsonl...]
       node analyze.mjs --selftest

Analyzes a fixes.jsonl exported by the spike harness and prints a ready-to-paste
markdown block per session with a PASS / FAIL / INCONCLUSIVE verdict.`;

const SESSION_SPLIT_MS = 10 * 60 * 1000; // ts jump > 10 min = forgotten "Clear" between runs
const MOVING_DIST_M = 15; // gap is MOVING if bounding fixes are >= 15 m apart...
const MOVING_SPEED_MS = 1.5; // ...or either bounding speed >= 1.5 m/s
const REPORT_GAP_S = 15; // list every gap above this, tagged
const PASS = { medianS: 5, p95S: 15, p99S: 30, maxS: 60, batchP95: 3, batteryPctHr: 8 };
// Delivery-delay p95 > 120 s = "sustained multi-minute batches (Doze)": most fixes
// arriving minutes late, not one outlier.
const FAIL = { movingGapS: 120, delayP95S: 120, batteryPctHr: 12 };

function haversineM(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(s));
}

// Nearest-rank percentile on an ascending-sorted array.
function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function parseJsonl(text) {
  const fixes = [];
  let malformed = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const f = JSON.parse(line);
      if (![f.ts, f.recvTs, f.lat, f.lng].every(Number.isFinite)) throw new Error('bad fields');
      fixes.push(f);
    } catch {
      malformed += 1;
    }
  }
  return { fixes, malformed };
}

function splitSessions(fixes) {
  const sorted = [...fixes].sort((a, b) => a.ts - b.ts);
  const sessions = [];
  for (const f of sorted) {
    const cur = sessions[sessions.length - 1];
    if (cur && f.ts - cur[cur.length - 1].ts <= SESSION_SPLIT_MS) cur.push(f);
    else sessions.push([f]);
  }
  return sessions;
}

function analyzeSession(fixes) {
  const gaps = [];
  for (let i = 1; i < fixes.length; i++) {
    const a = fixes[i - 1];
    const b = fixes[i];
    const distM = haversineM(a, b);
    const moving =
      distM >= MOVING_DIST_M || Math.max(a.speed ?? 0, b.speed ?? 0) >= MOVING_SPEED_MS;
    gaps.push({ s: (b.ts - a.ts) / 1000, moving, a, b, distM });
  }
  const dist = (subset) => {
    const sorted = subset.map((g) => g.s).sort((x, y) => x - y);
    return {
      n: sorted.length,
      median: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      max: sorted.length ? sorted[sorted.length - 1] : null,
    };
  };

  const byRecv = new Map();
  for (const f of fixes) byRecv.set(f.recvTs, (byRecv.get(f.recvTs) ?? 0) + 1);
  const batchSizes = [...byRecv.values()].sort((x, y) => x - y);
  const delays = fixes.map((f) => (f.recvTs - f.ts) / 1000).sort((x, y) => x - y);

  const withBat = fixes.filter((f) => typeof f.battery === 'number' && f.battery >= 0);
  let battery = { status: 'n/a', pctHr: null }; // gated | mixed | charging | n/a — only "gated" enters the verdict
  if (withBat.length >= 2) {
    const first = withBat[0];
    const last = withBat[withBat.length - 1];
    const hrs = (last.ts - first.ts) / 3600000;
    if (hrs > 0) {
      const pctHr = ((first.battery - last.battery) * 100) / hrs;
      // A rise anywhere mid-session means a partial charge: first/last %/hr looks
      // deceptively good, so refuse to gate it ("mixed") instead of reporting it.
      const rose = withBat.some((f, i) => i > 0 && f.battery > withBat[i - 1].battery + 0.005);
      battery =
        pctHr < 0
          ? { status: 'charging', pctHr }
          : rose
            ? { status: 'mixed', pctHr }
            : { status: 'gated', pctHr };
    }
  }

  return {
    fixes,
    startTs: fixes[0].ts,
    endTs: fixes[fixes.length - 1].ts,
    durationMin: (fixes[fixes.length - 1].ts - fixes[0].ts) / 60000,
    gaps,
    moving: dist(gaps.filter((g) => g.moving)),
    all: dist(gaps),
    batch: { p95: percentile(batchSizes, 95), max: batchSizes[batchSizes.length - 1] ?? null },
    delay: {
      median: percentile(delays, 50),
      p95: percentile(delays, 95),
      max: delays[delays.length - 1] ?? null,
    },
    battery,
  };
}

const fmtS = (s) => (s == null ? '—' : `${s.toFixed(1)} s`);
const fmtT = (ts) => new Date(ts).toLocaleTimeString('en-GB');

function verdictOf(m) {
  if (m.fixes.length < 2) return { verdict: 'INCONCLUSIVE', reasons: ['too few fixes to analyze'] };

  const fail = [];
  if (m.moving.max != null && m.moving.max > FAIL.movingGapS)
    fail.push(`moving gap ${fmtS(m.moving.max)} > ${FAIL.movingGapS} s`);
  if (m.delay.p95 != null && m.delay.p95 > FAIL.delayP95S)
    fail.push(`sustained batching — delivery delay p95 ${fmtS(m.delay.p95)} > ${FAIL.delayP95S} s`);
  if (m.battery.status === 'gated' && m.battery.pctHr > FAIL.batteryPctHr)
    fail.push(`battery ${m.battery.pctHr.toFixed(1)} %/hr > ${FAIL.batteryPctHr} %/hr`);
  if (fail.length) return { verdict: 'FAIL', reasons: fail };

  const inc = [];
  if (!m.moving.n) inc.push('no moving gaps recorded');
  else {
    if (m.moving.median > PASS.medianS)
      inc.push(`moving gap median ${fmtS(m.moving.median)} > ${PASS.medianS} s`);
    if (m.moving.p95 > PASS.p95S) inc.push(`moving gap p95 ${fmtS(m.moving.p95)} > ${PASS.p95S} s`);
    if (m.moving.p99 > PASS.p99S) inc.push(`moving gap p99 ${fmtS(m.moving.p99)} > ${PASS.p99S} s`);
    if (m.moving.max > PASS.maxS)
      inc.push(`moving gap max ${fmtS(m.moving.max)} in (${PASS.maxS}, ${FAIL.movingGapS}] s`);
  }
  if (m.batch.p95 != null && m.batch.p95 > PASS.batchP95)
    inc.push(`batch size p95 ${m.batch.p95} > ${PASS.batchP95}`);
  if (m.battery.status === 'gated' && m.battery.pctHr > PASS.batteryPctHr)
    inc.push(
      `battery ${m.battery.pctHr.toFixed(1)} %/hr in (${PASS.batteryPctHr}, ${FAIL.batteryPctHr}] %/hr`,
    );
  if (inc.length) return { verdict: 'INCONCLUSIVE', reasons: inc };
  return { verdict: 'PASS', reasons: [] };
}

function renderSession(m, idx, total, prevEndTs) {
  const v = verdictOf(m);
  const d = new Date(m.startTs);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const batteryCell =
    m.battery.status === 'gated'
      ? `${m.battery.pctHr.toFixed(1)} %/hr`
      : `${m.battery.status} (not gated)`;
  const lines = [
    `#### Session ${idx + 1}/${total} — ${date} ${fmtT(m.startTs)}–${fmtT(m.endTs)} local (${m.durationMin.toFixed(1)} min, ${m.fixes.length} fixes)`,
  ];
  if (prevEndTs != null)
    lines.push(
      '',
      `⚠️ starts ${((m.startTs - prevEndTs) / 60000).toFixed(1)} min after the previous session — separate run (forgotten Clear) or dead task? Dead task = FAIL per protocol ("task dies until relaunch"); this gap is in no gated table.`,
    );
  lines.push(
    '',
    '| Gap (consecutive `ts`) | Moving (gated) | All | PASS |',
    '|---|---|---|---|',
    `| median | ${fmtS(m.moving.median)} | ${fmtS(m.all.median)} | ≤ ${PASS.medianS} s |`,
    `| p95 | ${fmtS(m.moving.p95)} | ${fmtS(m.all.p95)} | ≤ ${PASS.p95S} s |`,
    `| p99 | ${fmtS(m.moving.p99)} | ${fmtS(m.all.p99)} | ≤ ${PASS.p99S} s |`,
    `| max | ${fmtS(m.moving.max)} | ${fmtS(m.all.max)} | ≤ ${PASS.maxS} s (FAIL > ${FAIL.movingGapS} s) |`,
    '',
    '| Delivery | Value | Gate |',
    '|---|---|---|',
    `| Batch size p95 (fixes per \`recvTs\`) | ${m.batch.p95 ?? '—'} (max ${m.batch.max ?? '—'}) | PASS ≤ ${PASS.batchP95} |`,
    `| Delivery delay median / p95 / max | ${fmtS(m.delay.median)} / ${fmtS(m.delay.p95)} / ${fmtS(m.delay.max)} | FAIL if p95 > ${FAIL.delayP95S} s |`,
    `| Battery | ${batteryCell} | PASS ≤ ${PASS.batteryPctHr}, FAIL > ${FAIL.batteryPctHr} %/hr |`,
    '',
    `Gaps > ${REPORT_GAP_S} s (local time · length · class · bounding speeds · distance):`,
  );
  const big = m.gaps.filter((g) => g.s > REPORT_GAP_S);
  if (!big.length) lines.push('- none');
  for (const g of big)
    lines.push(
      `- ${fmtT(g.a.ts)} · ${fmtS(g.s)} · ${g.moving ? 'MOVING' : 'STATIONARY'} · ${(g.a.speed ?? 0).toFixed(1)}/${(g.b.speed ?? 0).toFixed(1)} m/s · ${g.distM.toFixed(0)} m apart`,
    );
  lines.push('', `**Verdict: ${v.verdict}${v.reasons.length ? ` (${v.reasons.join('; ')})` : ''}**`);
  return lines.join('\n');
}

function analyzeText(text) {
  const { fixes, malformed } = parseJsonl(text);
  return { malformed, count: fixes.length, sessions: splitSessions(fixes).map(analyzeSession) };
}

// --- selftest: expected + edge + failure, no framework (throwaway register) ---

function selftest() {
  let failures = 0;
  const assertEq = (actual, expected, label) => {
    if (actual !== expected) {
      console.error(`SELFTEST FAIL: ${label}: expected ${expected}, got ${actual}`);
      failures += 1;
    }
  };
  const t0 = 1754550000000; // fixed epoch — selftest must not depend on wall clock
  const fix = (over) => ({ acc: 5, battery: 0.8, ...over });
  const toText = (fixes, extraLines = []) =>
    fixes
      .map((f) => JSON.stringify(f))
      .concat(extraLines)
      .join('\n') + '\n';

  // (a) expected: clean 4 s cadence while moving -> PASS
  const clean = [];
  for (let i = 0; i < 60; i++)
    clean.push(
      fix({ ts: t0 + i * 4000, recvTs: t0 + i * 4000 + 300, lat: 56.95 + i * 2e-4, lng: 24.1, speed: 8 }),
    );
  const a = analyzeText(toText(clean));
  assertEq(a.sessions.length, 1, '(a) session count');
  assertEq(verdictOf(a.sessions[0]).verdict, 'PASS', '(a) clean cadence verdict');
  assertEq(a.sessions[0].moving.median, 4, '(a) moving gap median');

  // (b) edge: 45 s gap bounded by stationary fixes (speed 0, < 15 m apart) is
  // excluded from the moving distribution -> still PASS
  const stop = clean.slice(0, 30);
  const last = stop[stop.length - 1];
  const s1 = fix({ ts: last.ts + 4000, recvTs: last.ts + 4300, lat: last.lat + 2e-5, lng: 24.1, speed: 0 });
  const s2 = fix({ ts: s1.ts + 45000, recvTs: s1.ts + 45300, lat: s1.lat + 3e-5, lng: 24.1, speed: 0 });
  const edge = [...stop, s1, s2];
  for (let i = 1; i <= 30; i++)
    edge.push(
      fix({ ts: s2.ts + i * 4000, recvTs: s2.ts + i * 4000 + 300, lat: s2.lat + i * 2e-4, lng: 24.1, speed: 8 }),
    );
  const b = analyzeText(toText(edge));
  const bGap = b.sessions[0].gaps.find((g) => g.s > REPORT_GAP_S);
  assertEq(bGap.moving, false, '(b) 45 s stationary gap tagged STATIONARY');
  assertEq(b.sessions[0].moving.max, 4, '(b) moving max excludes the stationary gap');
  assertEq(b.sessions[0].all.max, 45, '(b) unfiltered max still shows it');
  assertEq(verdictOf(b.sessions[0]).verdict, 'PASS', '(b) stationary-gap verdict');

  // (c) failure: Doze-batched stream — 130 s moving gap, then deliveries sharing
  // one recvTs with multi-minute delay -> FAIL; plus one malformed line skipped
  const doze = [];
  for (let i = 0; i < 20; i++)
    doze.push(
      fix({ ts: t0 + i * 4000, recvTs: t0 + i * 4000 + 300, lat: 56.95 + i * 2e-4, lng: 24.1, speed: 10 }),
    );
  const preGap = doze[doze.length - 1];
  const far = fix({ ts: preGap.ts + 130000, recvTs: preGap.ts + 130300, lat: preGap.lat + 0.01, lng: 24.1, speed: 10 });
  doze.push(far);
  const batchRecv = far.ts + 10 * 4000 + 180000; // one delivery, minutes late
  for (let k = 1; k <= 10; k++)
    doze.push(fix({ ts: far.ts + k * 4000, recvTs: batchRecv, lat: far.lat + k * 2e-4, lng: 24.1, speed: 10 }));
  const c = analyzeText(toText(doze, ['not json {{{']));
  assertEq(c.malformed, 1, '(c) malformed line counted');
  assertEq(c.count, doze.length, '(c) valid fixes still parsed');
  const cv = verdictOf(c.sessions[0]);
  assertEq(cv.verdict, 'FAIL', '(c) Doze verdict');
  assertEq(cv.reasons.some((r) => r.includes('moving gap')), true, '(c) 130 s gap is a FAIL reason');

  // (d) borderline: a 90 s moving gap lands in (60, 120] -> INCONCLUSIVE with an
  // explicit reason, never silently rounded into PASS
  const border = [];
  for (let i = 0; i < 30; i++)
    border.push(
      fix({ ts: t0 + i * 4000, recvTs: t0 + i * 4000 + 300, lat: 56.95 + i * 2e-4, lng: 24.1, speed: 8 }),
    );
  const preBorder = border[border.length - 1];
  border.push(
    fix({ ts: preBorder.ts + 90000, recvTs: preBorder.ts + 90300, lat: preBorder.lat + 0.005, lng: 24.1, speed: 8 }),
  );
  const dv = verdictOf(analyzeText(toText(border)).sessions[0]);
  assertEq(dv.verdict, 'INCONCLUSIVE', '(d) 90 s moving gap verdict');
  assertEq(
    dv.reasons.some((r) => r.includes(`moving gap max 90.0 s in (${PASS.maxS}, ${FAIL.movingGapS}] s`)),
    true,
    '(d) INCONCLUSIVE reason names the borderline gap',
  );

  // (e) split file: >10 min ts jump -> two sessions; the second session's render
  // must surface the inter-session gap (a dead task must not vanish into two
  // PASSes), the header date must be local (not UTC), and a mid-session battery
  // rise (partial charge) must come out "mixed", not "gated"
  const runA = [];
  for (let i = 0; i < 20; i++)
    runA.push(
      fix({
        ts: t0 + i * 4000, recvTs: t0 + i * 4000 + 300, lat: 56.95 + i * 2e-4, lng: 24.1, speed: 8,
        battery: i < 10 ? 0.85 - i * 0.005 : 0.83 - (i - 10) * 0.005, // dips, jumps up at i=10, dips again
      }),
    );
  const runBStart = runA[runA.length - 1].ts + 14 * 60000;
  const runB = [];
  for (let i = 0; i < 20; i++)
    runB.push(
      fix({ ts: runBStart + i * 4000, recvTs: runBStart + i * 4000 + 300, lat: 56.96 + i * 2e-4, lng: 24.1, speed: 8 }),
    );
  const e = analyzeText(toText([...runA, ...runB]));
  assertEq(e.sessions.length, 2, '(e) split into two sessions');
  assertEq(e.sessions[0].battery.status, 'mixed', '(e) mid-session battery rise not gated');
  const render2 = renderSession(e.sessions[1], 1, 2, e.sessions[0].endTs);
  assertEq(render2.includes('starts 14.0 min after the previous session'), true, '(e) inter-session gap surfaced');
  assertEq(render2.includes('Dead task = FAIL per protocol'), true, '(e) dead-task warning present');
  const localDate = new Date(runBStart).toLocaleDateString('en-CA'); // YYYY-MM-DD in local tz, independent of render
  assertEq(render2.includes(`— ${localDate} `), true, '(e) header date is local, not UTC');

  if (failures) {
    console.error(`selftest: ${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log(
    'selftest OK — 5 scenarios (clean PASS / stationary-gap edge / Doze FAIL / borderline INCONCLUSIVE / split-session render) passed',
  );
}

// --- main ---

const argv = process.argv.slice(2);
if (!argv.length) {
  console.error(USAGE);
  process.exit(1);
}
if (argv[0] === '--selftest') {
  selftest();
} else {
  let anyError = false;
  for (const path of argv) {
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch (e) {
      console.error(`ERROR: cannot read ${path}: ${e.message}`);
      anyError = true;
      continue;
    }
    const r = analyzeText(text);
    if (!r.count) {
      console.error(`ERROR: ${path}: no valid fixes found (${r.malformed} malformed line(s))`);
      anyError = true;
      continue;
    }
    if (r.malformed) console.error(`WARNING: ${path}: skipped ${r.malformed} malformed line(s)`);
    console.log(
      `\n<!-- analyze.mjs · ${basename(path)} · ${r.count} fixes · ${r.sessions.length} session(s)${r.malformed ? ` · ${r.malformed} malformed line(s) skipped` : ''} -->\n`,
    );
    if (r.sessions.length > 1)
      console.log(
        `**⚠️ ${r.sessions.length} sessions in one file** — if this was one continuous drive, the tracking task died and relaunched: FAIL per protocol ("task dies until relaunch"). The outage shows up only as the inter-session gap warnings below, never in a gated table.\n`,
      );
    r.sessions.forEach((m, i) =>
      console.log(renderSession(m, i, r.sessions.length, i ? r.sessions[i - 1].endTs : null) + '\n'),
    );
  }
  if (anyError) process.exit(1);
}
