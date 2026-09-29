// Offline tests run under the gate (`node --test` in @taxi/pr-scripts). Live tests are opt-in:
// CLAIM_CHECK_LIVE=1 with TYPESAFE_API_KEY. Turbo's strict env strips both, so the gate always skips them.
//
// The script is spawned ASYNCHRONOUSLY. spawnSync blocks this process's event loop, so the in-process stub
// below could never answer (observed during planning: 3050 ms TimeoutError under spawnSync, 148 ms ok async).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findClaims, resolveCitation, gitContext, questionsFor, checkBody } from './claim-check.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'claim-check.mjs');
const baseEnv = { ...process.env };
for (const k of Object.keys(baseEnv)) if (k === 'TYPESAFE_API_KEY' || k.startsWith('CLAIM_CHECK_')) delete baseEnv[k];
const live = Boolean(process.env.TYPESAFE_API_KEY) && process.env.CLAIM_CHECK_LIVE === '1';
const liveOpt = { skip: live ? false : 'set CLAIM_CHECK_LIVE=1 with TYPESAFE_API_KEY' };

// The #107 table, recovered from git (13cf8b0): `Observed` appears only in the column header.
const H107 = '### Level 4 — manual validation (the point of the ticket)';
const INTRO107 = '**Step 3 — observed, `CELLS=6`, `POLLS_PER_CELL=5`:**';
const HEADER107 = '| Quantity | Expected | **Observed** |';
const ROW107 = '| unquantized counterfactual | 30 | **30** |';
const ROW107_ETA = "| `geo.maps.route_fetched` `caller:'eta'` | 6 | **6** |";
const BODY107 = [H107, '', INTRO107, '', HEADER107, '|---|---|---|', ROW107_ETA, ROW107, ''].join('\n');
// #87's plan:336, recovered from git: a best-case interval labelled worst-case.
const S87 = "**Spend arithmetic (why this satisfies the guardrail):** page polls every 5 s; at the policy's own 25 km/h city average a driver crosses a ~100 m cell every ~15 s → worst-case ~1 paid call per 15 s per active ride *with a real provider*, vs 1 per 5 s without quantization";

const tmp = mkdtempSync(join(tmpdir(), 'claim-check-'));
const repo = join(tmp, 'repo');
const bodyFile = (name, text) => { const p = join(tmp, name); writeFileSync(p, text); return p; };

function run(args, env = {}, cwd = repo) {
  return new Promise((resolve) => {
    const t = Date.now();
    const c = spawn(process.execPath, [SCRIPT, ...args], { cwd, env: { ...baseEnv, ...env } });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    once(c, 'close').then(([code]) => resolve({ code, out, ms: Date.now() - t }));
  });
}

// Stub of POST /v1/systemone. Its answers copy the shape of a real jev-1.13.0 response (observed 2026-09-29).
const stub = { mode: 'ok', noul: 0.96, hits: 0, sockets: new Set(), url: '' };
const server = createServer((req, res) => {
  stub.hits++;
  let b = '';
  req.on('data', (c) => { b += c; });
  req.on('end', () => {
    if (stub.mode === 'hang') return;
    if (stub.mode === '403') {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ detail: { error_type: 'authentication_error', message: 'Must supply an API key!' } }));
      return;
    }
    const answers = Object.fromEntries(Object.entries(JSON.parse(b).questions).map(([id, q]) => [id, q.type === 'choice'
      ? { type: 'choice', choice: 'supports', confidence: 1, probabilities: { supports: 1, contradicts: 0, not_established: 0 } }
      : { type: 'noul', noul: stub.noul }]));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ model: 'jev-1.13.0', answers, usage: { input_tokens: 1, output_tokens: 1 } }));
  });
});
server.on('connection', (s) => { stub.sockets.add(s); s.on('close', () => stub.sockets.delete(s)); });

before(async () => {
  mkdirSync(join(repo, 'a'), { recursive: true });
  mkdirSync(join(repo, 'b'));
  writeFileSync(join(repo, 'a/x.ts'), 'line1\nline2\nline3\n');
  writeFileSync(join(repo, 'b/x.ts'), 'other\n');
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  stub.url = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  for (const s of stub.sockets) s.destroy();
  server.close();
});

const unitWith = (units, text) => units.find((u) => u.sentence.includes(text));
const stubEnv = () => ({ CLAIM_CHECK_BASE_URL: stub.url, TYPESAFE_API_KEY: 'dummy' });

test('1 parsing, expected: a figure is kept, an issue ref and a sha-and-date sentence are dropped', () => {
  const units = findClaims('Gate took 58 s (observed). See #302. Merged in da9c933 on 2026-09-29.\n');
  assert.equal(units.length, 1);
  assert.equal(units[0].sentence, 'Gate took 58 s (observed).');
  const qs = questionsFor(units[0]);
  assert.ok(qs.includes('provenance') && qs.includes('worst_case'), qs.join());
});

test('2 parsing, edge: table rows, indented code, nested bullets, section intros, fences, headings, comma lists', () => {
  const t = findClaims(BODY107);
  const row = unitWith(t, 'unquantized counterfactual');
  assert.equal(row.tableHeader, HEADER107);
  assert.equal(row.sectionIntro, INTRO107);
  assert.equal(row.heading, H107);
  assert.deepEqual(questionsFor({ ...row, sectionIntro: undefined }).slice(0, 2), ['provenance', 'not_measured'], 'header alone carries observed');
  assert.equal(t.filter((u) => u.tableHeader).length, 2, 'header and separator rows are not units');

  const gate = findClaims('Gate:\n\n```\nTasks: 23 successful, 23 total\n```\n    @taxi/api: Tests 694 passed\n    @taxi/db: Tests 12 passed\n');
  assert.equal(gate.length, 0, JSON.stringify(gate));

  const nested = findClaims('- Two runs\n  - First run\n    - At abc1234: 3 of 4 red\n');
  assert.ok(unitWith(nested, 'At abc1234: 3 of 4 red'), 'a 4-space nested bullet is kept');

  const MUT = '**Mutation checks** (`observed`; each change was reverted):';
  const mut = findClaims(`## Validation\n\n${MUT}\n\n- At \`36df1f2\`: 1 of 4 red.\n`);
  const bullet = unitWith(mut, '1 of 4 red');
  assert.equal(bullet.sectionIntro, MUT);
  assert.ok(questionsFor(bullet).includes('provenance'));

  assert.equal(findClaims('```\nlatency 99 ms\n```\n').length, 0, 'fenced code is ignored');
  assert.equal(findClaims('## Validation — observed\n\nGate took 58 s.\n')[0].heading, '## Validation — observed');

  const cites = findClaims('The override lives at `test/harness.ts:454,541` today.\n')[0].citations;
  assert.deepEqual(cites.map((c) => [c.path, c.from, c.to]), [['test/harness.ts', 454, 454], ['test/harness.ts', 541, 541]]);
});

test('3 extreme list (#87): listed for a human, never asked worst_case, printed with no key', async () => {
  const [u] = findClaims(`## NOTES (open canvas)\n\n${S87}\n`);
  assert.equal(u.extreme, true);
  assert.ok(!questionsFor(u).includes('worst_case'));
  const r = await run([bodyFile('b3.md', `## NOTES (open canvas)\n\n${S87}\n`)]);
  assert.equal(r.code, 0);
  assert.match(r.out, /Extreme-case claims: re-derive by hand:\n {2}L3 {2}"\*\*Spend arithmetic/);
});

test('4 citation, edge: exact path ok; ambiguous basename, past EOF and a wide range are unresolved', () => {
  const g = gitContext(repo);
  const cite = (path, from, to = from) => resolveCitation({ raw: `${path}:${from}`, path, from, to }, g.files, g.readAtHead);
  const ok = cite('a/x.ts', 2);
  assert.equal(ok.status, 'ok');
  assert.equal(ok.text, 'line2');
  assert.match(cite('x.ts', 2).reason, /ambiguous/);
  assert.match(cite('a/x.ts', 999).reason, /past EOF/);
  assert.match(cite('a/x.ts', 1, 100).reason, /wider than 60/);
});

test('5 expected, stubbed: a 0.96 provenance is flagged and the details block is printed', async () => {
  stub.mode = 'ok'; stub.noul = 0.96;
  const r = await run([bodyFile('b5.md', 'Gate took 58 s (observed).\n')], stubEnv());
  assert.equal(r.code, 0);
  assert.match(r.out, /L1 {2}provenance {2}FLAG {2}0\.96/);
  assert.match(r.out, /<details><summary>Claim check \(log-only, #302\): 3 flagged/);
});

test('6 edge, stubbed: a 0.04 provenance is logged with its p, not flagged', async () => {
  stub.mode = 'ok'; stub.noul = 0.04;
  const r = await run([bodyFile('b6.md', 'Gate took 58 s (observed).\n')], stubEnv());
  assert.equal(r.code, 0);
  assert.match(r.out, /L1 {2}provenance {2}ok {2}0\.04/);
  assert.doesNotMatch(r.out, /FLAG {2}/);
});

test('7 failure, key missing: a note, exit 0, and zero requests reach the API', async () => {
  stub.mode = 'ok'; stub.hits = 0;
  const r = await run([bodyFile('b7.md', 'Gate took 58 s (observed).\n')], { CLAIM_CHECK_BASE_URL: stub.url });
  assert.equal(r.code, 0);
  assert.match(r.out, /^note: TYPESAFE_API_KEY is not set/m);
  assert.equal(stub.hits, 0);
});

test('8 failure, API down: "Jev unavailable" and exit 0', async () => {
  const closed = createServer();
  closed.listen(0, '127.0.0.1');
  await once(closed, 'listening');
  const port = closed.address().port;
  closed.close();
  await once(closed, 'close');
  const r = await run([bodyFile('b8.md', 'Gate took 58 s (observed).\n')], { CLAIM_CHECK_BASE_URL: `http://127.0.0.1:${port}`, TYPESAFE_API_KEY: 'dummy' });
  assert.equal(r.code, 0);
  assert.match(r.out, /Jev unavailable: 1 of 1 requests failed/);
});

test('9 failure, 403 on a missing key header: a note and exit 0', async () => {
  stub.mode = '403';
  const r = await run([bodyFile('b9.md', 'Gate took 58 s (observed).\n')], stubEnv());
  assert.equal(r.code, 0);
  assert.match(r.out, /^note: L1 provenance,not_measured,worst_case: HTTP 403 authentication_error/m);
});

test('10 failure, budget (R3): a hanging API is cut off by the budget, not the per-request timeout', async () => {
  stub.mode = 'hang';
  const r = await run([bodyFile('b10.md', 'Gate took 58 s (observed).\n\nThe build took 12 s.\n')],
    { ...stubEnv(), CLAIM_CHECK_TIMEOUT_MS: '20000', CLAIM_CHECK_BUDGET_MS: '300' });
  assert.equal(r.code, 0);
  assert.match(r.out, /budget 0\.3 s exhausted: 2 of 2 requests not judged/);
  assert.match(r.out, /Not judged \(budget\):\n {2}L1 .*\n {2}L3 /);
  assert.ok(r.ms < 10_000, `took ${r.ms} ms`);
});

test('11 usage: no argument and a directory both exit 2', async () => {
  assert.equal((await run([], {}, tmpdir())).code, 2);
  assert.equal((await run([tmp], {}, tmpdir())).code, 2);
});

test('L1 live, expected: #107 counterfactual flagged on both questions, its measured sibling not', liveOpt, async () => {
  const r = await checkBody(BODY107, { key: process.env.TYPESAFE_API_KEY, git: gitContext(repo) });
  const p = (text, q) => r.verdicts.find((v) => v.sentence.includes(text) && v.question === q)?.p;
  assert.ok(p('counterfactual', 'provenance') >= 0.5, `provenance ${p('counterfactual', 'provenance')}`);
  assert.ok(p('counterfactual', 'not_measured') >= 0.5, `not_measured ${p('counterfactual', 'not_measured')}`);
  assert.ok(p("caller:'eta'", 'not_measured') < 0.5, `eta not_measured ${p("caller:'eta'", 'not_measured')}`);
});

test('L2 live, edge: a derived figure that shows its arithmetic is asked worst_case only, and not flagged', liveOpt, async () => {
  const row = '| `726 = 724 + 2`, `derived` | #203\'s review stamp at `cedc2a0` = api `77 / 724`; `git diff --stat cedc2a0..32fb6f7` = four `.claude/` docs + `harness.ts` +4 | condition stated and true; the arithmetic and the inheritance both hold |';
  const body = `### Figures audit\n\n| Figure | Source | Verdict |\n|---|---|---|\n${row}\n`;
  const [u] = findClaims(body);
  assert.deepEqual(questionsFor(u), ['worst_case']);
  const r = await checkBody(body, { key: process.env.TYPESAFE_API_KEY, git: gitContext(repo) });
  assert.ok(r.verdicts[0].p < 0.5, `worst_case ${r.verdicts[0].p}`);
});

test('L3 live, failure: a real key against a closed port is a note and exit 0', liveOpt, async () => {
  const r = await run([bodyFile('l3.md', 'Gate took 58 s (observed).\n')], { TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY, CLAIM_CHECK_BASE_URL: 'http://127.0.0.1:9' });
  assert.equal(r.code, 0);
  assert.match(r.out, /Jev unavailable/);
});
