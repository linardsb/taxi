#!/usr/bin/env node
// claim-check.mjs — a second reader for the claims in a draft PR body (#302). LOG-ONLY: it never blocks.
//
//   claim-check.mjs <draft-body.md> [--threshold 0.5]
//   claim-check.mjs --eval <labelled.jsonl> [--threshold 0.5]
//
// Code finds the claim units in the body: a sentence, or a table row carrying its column header row, kept only
// if it has a figure, a provenance word or a `file:line`. Fenced and indented code blocks are dropped; gate
// output pasted from record-gate.sh is already guaranteed by the script that printed it. Every `file:line` is
// resolved against `git ls-files` and its exact lines are read with `git show HEAD:<path>`, so only committed
// content leaves the machine. TypeSafe's Jev model (pinned to jev-1.13.0) then answers, per unit:
//
//   provenance    a figure labelled `observed` (in the sentence, heading, section intro or table header) with
//                 no producing run named. Asked only when `observed` appears.
//   not_measured  a figure presented as `observed` that no run could measure: a counterfactual, a prediction,
//                 a value computed from other figures (#107). Asked only when `observed` appears.
//   worst_case    a case-dependent figure with no case or condition named. Not asked of extreme-case claims.
//   citation_<n>  do the cited lines at HEAD support, contradict or not establish what the sentence says.
//
// A fifth check uses no model: every sentence that claims an extreme (worst case, best case, upper bound, at
// most, …) and has a figure is listed under "re-derive by hand". That is #87's shape — a best-case interval
// labelled worst-case — whose defect sat in an axis the sentence never mentions, so no sentence-level judgement
// can see it (planning probes, plan "Observed API behaviour"). The list routes it to a human; it does not judge.
//
// What this does NOT catch, stated so it is not oversold:
//   - arithmetic. The extreme-case list sends the #87 shape to a human, but nothing here checks a sum.
//   - a claim with no figure, no provenance word and no citation. It is never a unit.
//   - a citation that cannot be resolved uniquely (no such file, several matches, past EOF, a range wider than
//     60 lines). It is reported `unresolved` and never judged.
//   - any unit the time budget cut off. Those are listed as not judged.
//
// Output: the verdicts with their probabilities, the extreme-case list, the unresolved citations, a totals line,
// then a paste-ready <details> block for the PR body. Paste it; do not retype it. For the first 10 PRs that
// block is the log each review compares its own findings against (piv-review-pr, "The numbers pass").
//
// --eval sends each row of a labelled JSONL set with its frozen state and prints per-question counts at
// thresholds 0.3/0.5/0.7/0.9, a 3x3 citation matrix, every miss, and a provenance line. Its budget is 120 s,
// because a 50-row set is meant to finish.
//
// Environment: TYPESAFE_API_KEY (absent = no call, the would-send list is printed). Test seams:
// CLAIM_CHECK_BASE_URL (default https://api.typesafe.ai), CLAIM_CHECK_TIMEOUT_MS (per request, default 10000),
// CLAIM_CHECK_BUDGET_MS (whole run, default 30000; 120000 for --eval).
//
// Exit codes: 0 on every path — a missing key, an HTTP error, a timeout, a network failure, the budget running
// out and a crash each become a printed `note:`. 2 only for usage: no path, or a path that is not a regular file.

import { readFileSync, statSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const BASE = process.env.CLAIM_CHECK_BASE_URL ?? 'https://api.typesafe.ai';
const TIMEOUT_MS = Number(process.env.CLAIM_CHECK_TIMEOUT_MS ?? 10_000);
const BUDGET_MS = Number(process.env.CLAIM_CHECK_BUDGET_MS ?? 30_000);
const EVAL_BUDGET_MS = Number(process.env.CLAIM_CHECK_BUDGET_MS ?? 120_000);
const MODEL = 'jev-1.13.0';
const CONCURRENCY = 6;
const MAX_CITED_LINES = 60;

export const QUESTIONS = {
  provenance: { type: 'noul',
    instructions: 'The `sentence` labels a figure `observed`, either in its own text, in its `heading`, in its `section_intro` (the paragraph that introduces the list or block it sits in), or in the `table_header` column its figure sits under. Does the sentence, its heading and its section_intro together fail to name the run that produced the figure: a command, a CI run, a commit sha, or a dated session? A figure that is computed from other figures, or is a counterfactual, was not produced by a run.',
    criteria: { true: 'Labelled observed, and no producing run is named, or the figure is computed or counterfactual rather than measured',
                false: 'The producing run is named, or the figure is not labelled observed' } },
  not_measured: { type: 'noul',
    instructions: 'The `sentence` presents a figure as `observed` (in its text, `heading`, `section_intro` or `table_header` column). Is that figure something no run could have measured directly: a counterfactual (what would have happened otherwise), a prediction, or a value computed from other figures?',
    criteria: { true: 'A counterfactual, prediction or computed value presented as observed',
                false: 'A quantity a run could count or measure directly, such as a count of events, a status code, a test total or a duration' } },
  worst_case: { type: 'noul',
    instructions: 'Does the `sentence` state a figure that varies by case (a duration, an interval, a size, a cost, a count that depends on conditions) without saying which case it describes: best, worst, typical, or a named condition?',
    criteria: { true: 'A case-dependent figure with no case or condition named',
                false: 'The case or condition is named, or the figure does not vary by case (an exact count of a fixed thing, an id, a date, a status code, a test result)' } },
  citation: { type: 'choice',
    instructions: 'How do the `cited.text` lines (the exact lines at `cited.path` `cited.lines`) relate to what the `sentence` says about that location?',
    criteria: { supports: 'The lines state what the sentence says they contain or do, or directly imply it',
                contradicts: 'The lines state the opposite, or show the sentence is false about them',
                not_established: 'The lines do not address what the sentence asserts about them, either way' } },
};

// ---------- finder ----------

const LIST = /^\s*(?:[-*+]|\d+\.)\s+/;
const FENCE = /^\s*(```|~~~)/;
const HEADING = /^#{1,6}\s+/;
const TABLE_SEP = /^\|[\s:|-]*-[\s:|-]*\|?$/;
const CITE = /`?([\w./-]+\.[a-z]{1,5}):(\d+)(?:[-–](\d+))?((?:,\d+)*)`?/g;
const EXTREME = /\b(worst|best)[- ]case\b|\b(upper|lower) bound\b|\bat (most|least)\b|\bworst\b/i;
const OBSERVED = /\bobserved\b/i;
const PROVENANCE = /\b(observed|derived|expected)\b/i;

// Marks fenced blocks, and indented (4+ spaces or a tab) runs that are code: after a blank line or a closing
// fence, not under a list item, and holding no list marker. A nested bullet is kept.
function codeMask(lines) {
  const code = lines.map(() => false);
  let fence = null;
  lines.forEach((l, i) => {
    const m = l.match(FENCE);
    if (fence) { code[i] = true; if (m && l.trim().startsWith(fence)) fence = null; }
    else if (m) { fence = m[1]; code[i] = true; }
  });
  const indented = (l) => /^( {4}|\t)/.test(l) && l.trim() !== '';
  for (let i = 0; i < lines.length; i++) {
    if (code[i] || !indented(lines[i])) continue;
    let j = i;
    while (j < lines.length && !code[j] && indented(lines[j])) j++;
    const afterBreak = i === 0 || lines[i - 1].trim() === '' || (code[i - 1] && FENCE.test(lines[i - 1]));
    let k = i - 1;
    while (k >= 0 && lines[k].trim() === '') k--;
    const underList = k >= 0 && !code[k] && LIST.test(lines[k]);
    if (afterBreak && !underList && !lines.slice(i, j).some((l) => LIST.test(l))) for (let x = i; x < j; x++) code[x] = true;
    i = j - 1;
  }
  return code;
}

// Splits at `. `, `? ` or `! ` followed by an uppercase letter, a backtick or `*` (a bold lead-in such as
// `**L3** —`), never inside backticks.
function splitSentences(text) {
  const out = [];
  let start = 0;
  let tick = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '`') tick = !tick;
    else if (!tick && '.?!'.includes(text[i]) && text[i + 1] === ' ' && /[A-Z`*]/.test(text[i + 2] ?? '')) {
      out.push(text.slice(start, i + 1).trim());
      start = i + 2;
    }
  }
  const last = text.slice(start).trim();
  if (last) out.push(last);
  return out;
}

// A digit that is not an issue number, a sha, an ISO date, a file:line, a file name, a reference code (L2, T11,
// AC1) or a version.
function hasFigure(s) {
  const rest = s.replace(CITE, ' ')
    .replace(/[\w./-]+\.[a-z]{1,5}\b/g, ' ')
    .replace(/\b[A-Z]{1,3}\d+\b/g, ' ')
    .replace(/#\d+/g, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?/g, ' ')
    .replace(/\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/g, ' ')
    .replace(/\bv\d+(?:\.\d+)+\b|\b[a-z]\w*-\d+(?:\.\d+)+\b|\b\d+\.\d+\.\d+\b/gi, ' ');
  return /\d/.test(rest);
}

function parseCitations(s) {
  const out = [];
  for (const [raw, path, a, b, more] of s.matchAll(CITE)) {
    out.push({ raw, path, from: Number(a), to: Number(b ?? a) });
    for (const n of more.split(',').filter(Boolean)) out.push({ raw, path, from: Number(n), to: Number(n) });
  }
  return out;
}

export function findClaims(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const code = codeMask(lines);
  const units = [];
  let heading = '';
  let intro;
  let para = null;
  let tableHeader = null;

  const addUnit = (line, sentence, ctx) => {
    const citations = parseCitations(sentence);
    const figures = hasFigure(sentence);
    if (!figures && !PROVENANCE.test(sentence) && !citations.length) return;
    const context = [sentence, heading, ctx.sectionIntro, ctx.tableHeader].filter(Boolean).join('\n');
    units.push({
      line, heading,
      ...(ctx.sectionIntro && { sectionIntro: ctx.sectionIntro }),
      ...(ctx.tableHeader && { tableHeader: ctx.tableHeader }),
      sentence, figures, provenanceWord: PROVENANCE.test(context),
      extreme: figures && EXTREME.test(sentence), citations,
    });
  };
  const emit = (line, text, ctx) => { for (const s of splitSentences(text)) addUnit(line, s, ctx); };
  // `para` is the open block: a plain paragraph, which becomes the intro for what follows it, or a list item,
  // which carries the current intro.
  const flushPara = () => {
    if (!para) return;
    if (para.item) emit(para.line, para.text, { sectionIntro: intro });
    else { emit(para.line, para.text, {}); intro = para.text; }
    para = null;
  };

  lines.forEach((raw, i) => {
    const t = raw.trim();
    if (!t.startsWith('|')) tableHeader = null;
    if (code[i] || !t) return flushPara();
    if (HEADING.test(t)) { flushPara(); heading = t; intro = undefined; return; }
    if (t.startsWith('|')) {
      flushPara();
      if (!tableHeader) tableHeader = t;
      else if (!TABLE_SEP.test(t)) addUnit(i + 1, t, { sectionIntro: intro, tableHeader });
      return;
    }
    if (/^<\/?[a-z]/i.test(t)) return flushPara();
    if (LIST.test(raw)) { flushPara(); para = { line: i + 1, text: t.replace(LIST, ''), item: true }; return; }
    const text = t.replace(/^>\s?/, '');
    // A plain line right after a paragraph or a list item continues it: a wrapped item stays one block.
    if (para) para.text += ` ${text}`;
    else para = { line: i + 1, text };
  });
  flushPara();
  return units;
}

// ---------- citations ----------

export function resolveCitation(c, gitFiles, readAtHead) {
  const bad = (reason) => ({ status: 'unresolved', raw: c.raw, reason });
  if (c.from < 1 || c.to < c.from) return bad('range reversed or zero');
  if (c.to - c.from + 1 > MAX_CITED_LINES) return bad(`range wider than ${MAX_CITED_LINES} lines`);
  const p = c.path.replace(/^\.\//, '');
  const hits = p.includes('/') && gitFiles.includes(p) ? [p]
    : gitFiles.filter((f) => f === p || f.endsWith(`/${p}`));
  if (!hits.length) return bad('no such file at HEAD');
  if (hits.length > 1) return bad(`ambiguous: ${hits.length} files match`);
  let text;
  try { text = readAtHead(hits[0]); } catch { return bad('cannot read at HEAD'); }
  const all = text.split('\n');
  if (all.at(-1) === '') all.pop();
  if (c.to > all.length) return bad(`line past EOF (${all.length} lines)`);
  return { status: 'ok', raw: c.raw, path: hits[0], lines: `${c.from}-${c.to}`, text: all.slice(c.from - 1, c.to).join('\n') };
}

// git runs with an argv array and no shell; `show` only ever receives an exact `git ls-files` entry.
export function gitContext(cwd = process.cwd()) {
  const run = (args, dir) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  const none = { files: [], readAtHead: () => { throw new Error('no repository'); }, head: 'none' };
  let root;
  try { root = run(['rev-parse', '--show-toplevel'], cwd).trim(); } catch { return { ...none, note: 'not inside a git repository: every citation is unresolved' }; }
  let files = [];
  let head = 'none';
  let note;
  try { files = run(['ls-files', '-z'], root).split('\0').filter(Boolean); } catch { note = 'git ls-files failed: every citation is unresolved'; }
  try { head = run(['rev-parse', '--short', 'HEAD'], root).trim(); } catch { note = 'no commit at HEAD: every citation is unresolved'; }
  const cache = new Map();
  const readAtHead = (path) => {
    if (!files.includes(path)) throw new Error('not tracked');
    if (!cache.has(path)) cache.set(path, run(['show', `HEAD:${path}`], root));
    return cache.get(path);
  };
  return { files, readAtHead, head, ...(note && { note }) };
}

// ---------- Jev client ----------

export function questionsFor(u) {
  const ids = [];
  if (OBSERVED.test([u.sentence, u.heading, u.sectionIntro, u.tableHeader].filter(Boolean).join('\n'))) ids.push('provenance', 'not_measured');
  if (u.figures && !u.extreme) ids.push('worst_case');
  return ids;
}

const stateFor = (u) => ({
  sentence: u.sentence, heading: u.heading,
  ...(u.sectionIntro && { section_intro: u.sectionIntro }),
  ...(u.tableHeader && { table_header: u.tableHeader }),
});

// One request for a unit's Nouls, and one per resolved citation, so each state holds at most one cited block.
function buildRequests(units, git) {
  const requests = [];
  const unresolved = [];
  for (const u of units) {
    const base = stateFor(u);
    const nouls = questionsFor(u);
    if (nouls.length) requests.push({ unit: u, state: base, questions: Object.fromEntries(nouls.map((q) => [q, QUESTIONS[q]])) });
    u.citations.forEach((c, n) => {
      const r = resolveCitation(c, git.files, git.readAtHead);
      if (r.status !== 'ok') { unresolved.push({ line: u.line, ...r }); return; }
      requests.push({ unit: u, cite: `${r.path}:${r.lines}`, state: { ...base, cited: { path: r.path, lines: r.lines, text: r.text } },
        questions: { [`citation_${n}`]: QUESTIONS.citation } });
    });
  }
  return { requests, unresolved };
}

async function askJev(req, key, signal) {
  const res = await fetch(`${BASE}/v1/systemone`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, state: req.state, questions: req.questions }),
    signal,
  });
  const body = await res.json().catch(() => ({}));
  // !res.ok, not a 401 check: a missing header gives 403 (observed), which the docs do not list.
  if (!res.ok) throw new Error(`HTTP ${res.status} ${body?.detail?.error_type ?? ''}`.trim());
  return body;
}

// A pool of CONCURRENCY workers, no retries. The budget aborts in-flight requests and stops queued ones; its
// timer is unref'd and cleared so it never holds the process open.
async function runAll(requests, key, budgetMs) {
  const budget = new AbortController();
  const timer = setTimeout(() => budget.abort(), budgetMs);
  timer.unref();
  const out = new Array(requests.length);
  let next = 0;
  const worker = async () => {
    while (next < requests.length && !budget.signal.aborted) {
      const i = next++;
      // Not AbortSignal.timeout(): inside AbortSignal.any() on Node 20 it is garbage-collected and never fires
      // (observed under --expose-gc on v20.20.2). This controller is held by its own timer, cleared below.
      const perRequest = new AbortController();
      const t = setTimeout(() => perRequest.abort(), TIMEOUT_MS);
      try {
        out[i] = { ok: true, body: await askJev(requests[i], key, AbortSignal.any([perRequest.signal, budget.signal])) };
      } catch (e) {
        out[i] = { ok: false, reason: budget.signal.aborted ? 'budget' : perRequest.signal.aborted ? `timeout ${TIMEOUT_MS / 1000} s` : (e.cause?.code ?? e.message) };
      } finally { clearTimeout(t); }
    }
  };
  try { await Promise.all(Array.from({ length: Math.min(CONCURRENCY, requests.length) }, worker)); }
  finally { clearTimeout(timer); }
  return { out, budgetHit: budget.signal.aborted };
}

export async function checkBody(markdown, { key, git }) {
  const units = findClaims(markdown);
  const { requests, unresolved } = buildRequests(units, git);
  const r = { units, requests, unresolved, extreme: units.filter((u) => u.extreme), verdicts: [], failed: [], unjudged: [],
    notes: git.note ? [git.note] : [], model: 'none', head: git.head, date: new Date().toISOString(), sent: false };
  if (!requests.length) return r;
  if (!key) {
    r.notes.push(`TYPESAFE_API_KEY is not set: no Jev call made; the ${requests.length} requests below would have been sent.`);
    return r;
  }
  r.sent = true;
  const { out, budgetHit } = await runAll(requests, key, BUDGET_MS);
  requests.forEach((req, i) => {
    const o = out[i];
    if (!o || o.reason === 'budget') return void r.unjudged.push(req);
    if (!o.ok) return void r.failed.push({ req, reason: o.reason });
    r.model = o.body.model ?? r.model;
    for (const id of Object.keys(req.questions)) {
      const a = o.body.answers?.[id];
      const v = { line: req.unit.line, sentence: req.unit.sentence };
      if (a?.choice !== undefined) r.verdicts.push({ ...v, question: `citation ${req.cite}`, verdict: a.choice, p: a.probabilities?.[a.choice], flag: a.choice !== 'supports' });
      else if (typeof a?.noul === 'number') r.verdicts.push({ ...v, question: id, p: a.noul });
      else r.failed.push({ req, reason: `no answer for ${id}` });
    }
  });
  for (const f of r.failed) r.notes.push(`L${f.req.unit.line} ${Object.keys(f.req.questions).join(',')}: ${f.reason}`);
  if (budgetHit) r.notes.push(`budget ${BUDGET_MS / 1000} s exhausted: ${r.unjudged.length} of ${requests.length} requests not judged.`);
  const lost = r.failed.length + r.unjudged.length;
  if (!r.verdicts.length && lost === requests.length) {
    r.unavailable = `Jev unavailable: ${lost} of ${requests.length} requests failed, first: ${r.failed[0]?.reason ?? 'budget'}`;
  }
  return r;
}

// ---------- report ----------

const fmtP = (p) => (typeof p === 'number' ? p.toFixed(2) : '-');
const quote = (s) => `"${s.length > 100 ? `${s.slice(0, 99)}…` : s}"`;

export function formatReport(r, threshold = 0.5) {
  const rows = r.verdicts.map((v) => ({ ...v, flag: v.flag ?? v.p >= threshold }));
  const flagged = rows.filter((v) => v.flag).length;
  const qCount = r.requests.reduce((n, req) => n + Object.keys(req.questions).length, 0);
  const body = [];
  if (r.requests.length && !r.sent) {
    body.push('Would send (no key):');
    for (const req of r.requests) body.push(`  L${req.unit.line}  ${Object.keys(req.questions).join(',')}  ${quote(req.unit.sentence)}`);
  } else if (r.unavailable) body.push(r.unavailable);
  else if (rows.length) {
    body.push(`Verdicts (FLAG = Noul p >= ${threshold}, or a citation that is not \`supports\`):`);
    rows.sort((a, b) => Number(b.flag) - Number(a.flag) || a.line - b.line);
    for (const v of rows) body.push(`  L${v.line}  ${v.question}  ${v.flag ? 'FLAG' : 'ok'}${v.verdict ? ` ${v.verdict}` : ''}  ${fmtP(v.p)}  ${quote(v.sentence)}`);
  } else body.push('No claim units to judge.');
  if (r.unjudged.length) {
    body.push('', 'Not judged (budget):');
    for (const req of r.unjudged) body.push(`  L${req.unit.line}  ${Object.keys(req.questions).join(',')}  ${quote(req.unit.sentence)}`);
  }
  body.push('', 'Extreme-case claims: re-derive by hand:');
  body.push(...(r.extreme.length ? r.extreme.map((u) => `  L${u.line}  ${quote(u.sentence)}`) : ['  (none)']));
  body.push('', 'Unresolved citations (never sent):');
  body.push(...(r.unresolved.length ? r.unresolved.map((u) => `  L${u.line}  ${u.raw}  ${u.reason}`) : ['  (none)']));
  body.push('', `units ${r.units.length} · questions ${qCount} · flagged ${flagged} · extreme ${r.extreme.length} · unresolved ${r.unresolved.length} · failed ${r.failed.length + r.unjudged.length} · model ${r.model} · head ${r.head} · ${r.date}`);
  const notes = r.notes.map((n) => `note: ${n}`);
  return [
    ...notes, ...(notes.length ? [''] : []), ...body, '',
    `<details><summary>Claim check (log-only, #302): ${flagged} flagged, ${r.extreme.length} to re-derive</summary>`,
    '', '```text', ...notes, ...body, '```', '', '</details>', '',
  ].join('\n');
}

// ---------- eval ----------

const NOUL_QUESTIONS = ['provenance', 'not_measured', 'worst_case'];
const CHOICES = ['supports', 'contradicts', 'not_established'];

export async function evalSet(rows, key) {
  const requests = rows.map((row) => ({ unit: { line: 0, sentence: row.state.sentence }, state: row.state, questions: { [row.question]: QUESTIONS[row.question] } }));
  const { out } = await runAll(requests, key, EVAL_BUDGET_MS);
  let model = 'none';
  const results = rows.map((row, i) => {
    const o = out[i];
    if (!o?.ok) return { row, error: o?.reason ?? 'budget' };
    model = o.body.model ?? model;
    const a = o.body.answers?.[row.question];
    if (a?.choice !== undefined) return { row, choice: a.choice, p: a.probabilities?.[a.choice] };
    if (typeof a?.noul === 'number') return { row, p: a.noul };
    return { row, error: 'no answer' };
  });
  return { results, model };
}

function formatEval({ results, model }, threshold, meta) {
  const out = [];
  const pct = (a, b) => (b ? (a / b).toFixed(2) : '-');
  for (const q of NOUL_QUESTIONS) {
    const rs = results.filter((r) => r.row.question === q && !r.error);
    const pos = rs.filter((r) => r.row.label === true).length;
    out.push(`${q} (n=${rs.length}: ${pos} true, ${rs.length - pos} false)`, '  t     TP  FP  FN  TN  precision  recall');
    for (const t of [0.3, 0.5, 0.7, 0.9]) {
      const c = { tp: 0, fp: 0, fn: 0, tn: 0 };
      for (const r of rs) c[`${r.p >= t === r.row.label ? 't' : 'f'}${r.p >= t ? 'p' : 'n'}`]++;
      out.push(`  ${t.toFixed(1)}  ${[c.tp, c.fp, c.fn, c.tn].map((n) => String(n).padStart(3)).join(' ')}  ${pct(c.tp, c.tp + c.fp).padStart(9)}  ${pct(c.tp, c.tp + c.fn).padStart(6)}`);
    }
    out.push('');
  }
  const cites = results.filter((r) => r.row.question === 'citation' && !r.error);
  out.push(`citation (n=${cites.length}; rows = label, columns = Jev's choice)`, `  ${''.padEnd(16)}${CHOICES.map((c) => c.padStart(16)).join('')}`);
  for (const l of CHOICES) out.push(`  ${l.padEnd(16)}${CHOICES.map((c) => String(cites.filter((r) => r.row.label === l && r.choice === c).length).padStart(16)).join('')}`);
  out.push('', `Misses at threshold ${threshold}:`);
  const misses = results.filter((r) => !r.error && (r.row.question === 'citation' ? r.choice !== r.row.label : r.p >= threshold !== r.row.label));
  out.push(...(misses.length ? misses.map((r) => `  ${r.row.id}  ${r.row.question}  label ${r.row.label}  got ${r.choice ?? ''}${r.choice ? ' ' : ''}${fmtP(r.p)}`) : ['  (none)']));
  const errors = results.filter((r) => r.error);
  if (errors.length) out.push('', 'Not judged:', ...errors.map((r) => `  ${r.row.id}  ${r.error}`));
  out.push('', `observed ${new Date().toISOString()} · model ${model} · ${results.length} rows · labelled-set blob ${meta.blob} · head ${meta.head}`, '');
  return out.join('\n');
}

async function runEval(path, key, threshold) {
  const rows = [];
  readFileSync(path, 'utf8').split('\n').forEach((l, i) => {
    if (!l.trim()) return;
    try { rows.push(JSON.parse(l)); } catch { process.stdout.write(`note: line ${i + 1} is not JSON; skipped\n`); }
  });
  if (!key) return void process.stdout.write(`note: TYPESAFE_API_KEY is not set: no Jev call made; ${rows.length} rows not scored.\n`);
  const git = (args) => { try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return 'none'; } };
  const ev = await evalSet(rows, key);
  process.stdout.write(formatEval(ev, threshold, { blob: git(['hash-object', path]), head: git(['rev-parse', '--short', 'HEAD']) }));
}

// ---------- CLI ----------

async function main(argv) {
  const usage = (code = 2) => {
    process.stderr.write('usage: claim-check.mjs <draft-body.md> [--threshold 0.5]\n       claim-check.mjs --eval <labelled.jsonl> [--threshold 0.5]\n');
    return code;
  };
  let bodyPath;
  let evalPath;
  let threshold = 0.5;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--threshold') { threshold = Number(argv[++i]); if (!(threshold >= 0 && threshold <= 1)) return usage(); }
    else if (a === '--eval') { evalPath = argv[++i]; if (!evalPath) return usage(); }
    else if (a === '-h' || a === '--help') return usage(0);
    else if (!bodyPath) bodyPath = a;
    else return usage();
  }
  const path = evalPath ?? bodyPath;
  if (!path || (evalPath && bodyPath)) return usage();
  // statSync().isFile(), not "readable": a directory is readable and extracts nothing.
  let isFile = false;
  try { isFile = statSync(path).isFile(); } catch { /* reported below */ }
  if (!isFile) { process.stderr.write(`cannot read file ${path}\n`); return 2; }
  const key = process.env.TYPESAFE_API_KEY || '';
  if (evalPath) await runEval(evalPath, key, threshold);
  else process.stdout.write(formatReport(await checkBody(readFileSync(path, 'utf8'), { key, git: gitContext() }), threshold));
  return 0;
}

// realpathSync: macOS /tmp and /var are symlinks to /private/…, and a symlinked argv never matches.
const isMain = (() => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } })();
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (e) => { process.stdout.write(`note: claim-check crashed, nothing judged: ${e?.stack ?? e}\n`); process.exitCode = 0; },
  );
}
