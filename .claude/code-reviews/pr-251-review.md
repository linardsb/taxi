# PR #251 review — round 1

**Head** `270bfe4` · **Base** `main` @ `487570f` · **Reviewed** 2026-09-21 · `fix/tracking-url-shape-and-noindex-246-247`

Base has not moved: `git rev-parse origin/main` = `487570f`, the same sha the PR records. Guarantees pass not
applicable; no prior round, so no fix-mechanism pass. There is no plan and no implementation report for
either ticket — deliberate, per the PR body ("one commit each rather than one loop each") — so the constraint
pass has nothing to grep. Recording the absence rather than counting it as a gap.

## Verdict

**Approve.** No Critical, no High. `mergeStateStatus: CLEAN`, 5/5 checks green, gate green at 22/22.

**The PR delivers its two tickets in full.** #246's own suggested fix is "reject a stripped host containing
any of `@ # ?`" and decide the `i`-flag question — both done, the second with reasoning and a test. #247's two
controls are wired and derived from the shared contract. F1 below is a **newly found instance of the same
class**, not an unmet acceptance criterion.

| | Severity | Where |
|---|---|---|
| F1 | Medium | `services/api/src/common/config/env.schema.ts:63-67` — whitespace, control characters and `\` survive all three gates; four forms boot and text a dead link |
| F2 | Medium | `docs/runbooks/hetzner-deploy.md:222`, `:164-169`, `:263`, `:810-825` — the operator-facing doc describes the old gate at four sites, and one of its claims silently widened |
| F3 | Low | PR #251 body, §"What changed" — "the same 15 values" over a 13-row table |
| F4 | Low | `apps/dispatch/src/app/t/tracking-noindex.test.ts:22-56` — nothing pins `userAgent: '*'` |
| F5 | Low | `…/tracking-noindex.test.ts:52` — re-asserts the one-character property that #245's review deliberately moved to `packages/shared`, 15 lines from where that decision is written down |
| F6 | Low | `…/tracking-noindex.test.ts:24,34,46` — three `as` casts over a real `Rule \| Rule[]` union |
| F7 | Low | `services/api/src/common/config/env.schema.ts:421-429` — indexed read types as `string \| undefined` |
| F8 | Low | `services/api/src/common/config/env.schema.ts:418-448` — both new checks are production-only; hoisting them costs nothing |

Findings marked **`reproduced`** were run, not reasoned about. The `code-reviewer` agent declared up front
that it ran nothing and every claim was `derived`; F1, F4, F5 and F7 come from it and **every one was
re-run or re-read here before entering this report**. One of its concerns is refuted below.

**#245's F8 is discharged, but not by the fix it prescribed — recorded so it is not re-raised.** F8 said "an
`i` flag plus rejecting `@#?`". This PR rejects `@?#` and **declines the `i` flag**, refusing a non-lowercase
scheme at the gate instead, because an `i` flag would change what a pure function emits on the rider SMS send
path and would flip `HTTPS://SAKTA.LV` from refused (16 characters) to accepted (8). `reproduced`: all four
rows of F8's own table, including the `https://sakta.lv#f` escape that booted at exactly 10 characters, are
refused at HEAD.

## Validation

`REDIS_TEST_URL=redis://localhost:6381 COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build
--force`, run in `wt-246-247` at `270bfe4` from a cleared `apps/dispatch/.next`:

| | result |
|---|---|
| turbo | **22 successful, 22 total**, exit 0, 1m39.305s (`observed`) |
| `@taxi/api` | 81 suites, **794 passed**, 0 skipped — the gated Redis suites ran |
| `@taxi/rider` | 30 suites, 145 passed |
| `@taxi/driver` | 44 suites, 250 passed |

The PR body claims 22/22 and `@taxi/api` 794/81 with 0 skipped. Both reproduce. Its 1m30.453s against my
1m39.305s is machine load; the body labels it as its own run, so this is agreement, not a discrepancy.

### The numbers pass

**The before/after table — all 13 rows, `reproduced`.** I pushed every listed value through the *compiled*
schema (`services/api/dist/common/config/env.schema.js`) at HEAD, and derived the before column from the
base's own rules, read at `487570f`: at that commit the only rules on this variable were the localhost check
and the length check, so the before verdict is determined rather than taken on trust. Every row matches the
table in both columns — the five that flip flip, and `ftp://s.lv` is accepted at base (10 characters, exactly
at the ceiling) and refused at HEAD on the scheme.

**Both mutation claims, both halves each.** The PR body asserts that removing the `robots` key fails the new
dispatch case *and* that "nothing else would have caught its removal". The second half is the one nothing
normally executes — the exact shape #137 shipped false into four places — so I ran it:

- `reproduced`: with `robots: { index: false, follow: false }` removed from `generateMetadata`, the **full**
  dispatch suite (all 30 files) reports **1 failed | 271 passed**. The single failure is the new case. True
  on both halves.
- `reproduced`: narrowing `robots.ts` to a hardcoded `disallow: ['/t/']` fails **2 of the 3** cases in
  `tracking-noindex.test.ts`. The derivation from `TRACKING_PATH_BY_LANGUAGE` is genuinely pinned.
- Working tree restored and confirmed clean after every mutation (`git status --porcelain` empty).

**`/robots.txt` is a real route and its body is right.** The build log lists `○ /robots.txt` as prerendered,
and the emitted `apps/dispatch/.next/server/app/robots.txt.body` is exactly:

```
User-Agent: *
Disallow: /t/
Disallow: /r/
Disallow: /e/
```

All three shapes #136 created. `TRACKING_PATH_BY_LANGUAGE` is `{lv:'t', ru:'r', en:'e'}`, so the derivation
covers the real route and both rewrites.

**File size.** `env.schema.ts` is **477** lines against a `max-lines` cap of **500**
(`packages/config/eslint/base.mjs:36`, `skipComments: false`) — 23 lines of headroom, disclosed by the author.
`env.schema.spec.ts` at 679 lines is exempt via the test override at `base.mjs:47-57`. No `eslint-disable` in
any of the six files. Worth noting in the PR body: this file was **already split once** for this budget
(`sms-env.schema.ts`, comment at `:294-299`) and now sits at 95% of the cap.

## Findings

### F1 — Medium · whitespace, control characters and `\` survive all three gates and text a dead link · `services/api/src/common/config/env.schema.ts:63-67`

The WHATWG URL parser strips leading/trailing spaces and C0 controls from its *input* and removes tab/CR/LF
before parsing, so `new URL('https://sakta.lv ')` succeeds. zod returns the **original string** unchanged
(`node_modules/zod/v3/types.js:631-643`), and `trackingLinkHost` strips only `^https?://` and trailing `/`
(`tracking-link.ts:108` tests `charCodeAt(...) === 47` and nothing else). Nothing else in the chain looks at
whitespace.

`reproduced` 2026-09-21 through the compiled `dist` at HEAD, with the SMS body built by `trackingLink`:

| configured | SMS carries | len | verdict at HEAD |
|---|---|---|---|
| `https://sakta.lv␠` (trailing space) | `sakta.lv /r/<token>` | 9 | **boots** |
| `https://sakta.lv\tx` | `sakta.lv\tx/r/<token>` | 10 | **boots** |
| `https://sakta.lv\nx` | `sakta.lv\nx/r/<token>` | 10 | **boots** |
| `https://s.lv\x` | `s.lv\x/r/<token>` | 6 | **boots** |
| `␠https://sakta.lv` (leading space) | — | 17 | refused, **by length** |

That last row is the bug's own pattern one more time: caught incidentally, for the wrong reason, and only
because the space pushed it past 10.

**Consequence** (`derived`, not run — linkifier behaviour is client-side): every SMS linkifier terminates a
URL at a space, so the rider taps `sakta.lv` and lands on the dispatch app root, not their tracking page. The
`\t`/`\n` forms are the same class — dotenv expands `\n` inside double quotes. The `\` form is weaker: a
linkifier that normalises `\`→`/` lands on `/x/r/<token>` and 404s, one that stops at `\` lands on the root.

**Why this is reachable.** `docs/runbooks/hetzner-deploy.md:205` has the operator **hand-write** the host env
file at `/opt/taxi/.env`. A trailing space from a copy-paste is the most ordinary way this happens.

**Severity is a judgement call, made explicit.** #245's F8 rated the analogous fragment escape **Low**
("it takes a malformed operator config, and there is exactly one operator"). I am rating this **Medium**
because the variable now carries a gate that advertises itself as a shape filter, so a gap in it is more
surprising than a gap in a length-only check, and because a trailing space is likelier than a fragment.
Overrule me down to Low if you prefer consistency with F8 — the fix is the same either way.

**In scope for this PR?** Strictly, no: #246 asked for `@ # ?` and got them. But the fix is one line in the
same block, and deferring means a third PR on this one variable.

**Fix** — one catch-all beside the map rather than a fourth entry, since these have no per-character reason
worth quoting:

```ts
if (/[\s\u0000-\u001f\u007f]/.test(smsHost)) {
  // addIssue: whitespace or a control character in the SMS-facing host
}
```

An allowlist (`/^[a-z0-9.-]+(\/[\w.~-]+)*$/i` over `smsHost`) is complete by construction, but it costs the
per-character *reason* in the message, which is this design's main value. Not worth the trade.

### F2 — Medium · the deploy runbook describes the old gate at four sites, and one claim silently widened · `docs/runbooks/hetzner-deploy.md:222`, `:164-169`, `:263`, `:810-825`

The *rules* are well covered — the spec's `prod()` fixture parses the schema under `NODE_ENV=production`, so
the eight new cases exercise them. What no test reaches is the **operator's** side: which value to set. That
lives only in `docs/runbooks/hetzner-deploy.md`, which CLAUDE.md names as the read-first doc for production
env vars, and it is now behind the code at four sites:

- **`:222`**, the §3 env table row — the line an operator reads while setting the variable: *"Production
  refuses localhost, and refuses a host over 10 characters (#136). … Scheme and any trailing slash do not
  count."* Both halves are now incomplete. An operator reading this concludes `https://u@s.lv` boots — it did
  at `487570f`, and this PR is the change that stops it. And "scheme … does not count" reads as *the scheme is
  ignored*, when its spelling is now itself a gate.
- **`:164-169`**, the DNS section, repeats the under-statement.
- **`:810-825`**, the **Break | Refusal** probe table — the operator's checklist of gates to exercise against
  the built image. It has two `PUBLIC_TRACKING_BASE_URL` rows (localhost, 11-character host) and no row for
  either new refusal.
- **`:263`**: *"Every one of these gates was exercised against the built image on a laptop before a server
  existed (§8.3)."* The subject — *"these gates"* — widened when this PR added two gates to that table's own
  variable, and those two were **not** exercised against the built image. Retiring or widening a claim means
  handling its subject, not its digits; this is the pattern that shipped twice already (#87, #107).

**Fix**: one edit pass to `hetzner-deploy.md` — name all three rules at `:222`, correct the "scheme does not
count" clause, extend `:164-169`, add two rows to the `:810-825` table, and narrow `:263` to the gates it
covers (or exercise the two new ones and say so). Reasonable to **fold into #13** per the #250 deferral rule;
#13's plan carries the same gap at `.claude/plans/deploy-hetzner-environment.md:271-273`.

### F3 — Low · "the same 15 values" over a table of 13 · PR #251 body, §"What changed"

The table has **13** rows. The prose above it says the run pushed "the same 15 values".

I resolved which reading is right rather than re-counting, because the two differ in severity: if the run used
15 and the table dropped 2, two observed verdicts went unreported (Medium); if it used 13, it is a stray digit
(Low). **All 13 rows reproduce exactly** in my own run, and the body's own accounting closes over exactly
those 13 — 5 flip, 4 gain a reason, 3 accepts unchanged, 1 (`https://sakta.lv/app`) stays a plain length
refusal. Nothing references a 14th or 15th value. Stray digit.

**Fix**: change `15` to `13` in the PR body.

### F4 — Low · nothing pins `userAgent: '*'` · `apps/dispatch/src/app/t/tracking-noindex.test.ts:22-56`

`reproduced`: changing `robots.ts:28` to `userAgent: 'Googlebot'` leaves **all 3 cases green**, while the
robots.txt stops restricting every other crawler — the precise property the file's own header claims ("every
public shape of it has to be disallowed before a crawler requests it").

**Fix**: one line in the expected case — `expect(robots().rules).toMatchObject({ userAgent: '*' })`.

### F5 — Low · re-asserts a property this repo already decided belongs in `packages/shared` · `apps/dispatch/src/app/t/tracking-noindex.test.ts:52`

`expect(rule, rule).toMatch(/^\/[a-z]\/$/)` re-tests that every `TRACKING_PATH_BY_LANGUAGE` value is one
character. The sibling file 15 lines away records the decision not to do that, as a PR #245 review fix —
`tracking-rewrites.test.ts:97-100`: *"that every value in `TRACKING_PATH_BY_LANGUAGE` is one character is
asserted where the constant lives (`packages/shared/tests/tracking-link.test.ts`), and was re-asserted here
for no added coverage."* Verified by reading both files.

Line 53's `expect(minted, rule).toContain(rule.slice(1, -1))` is the assertion that carries this file's own
concern.

**Fix**: drop the regex, or narrow it to `/^\/.+\/$/` so it checks the `/x/` *wrapping* this file owns rather
than the character width `packages/shared` owns.

### F6 — Low · three `as` casts over a real union · `apps/dispatch/src/app/t/tracking-noindex.test.ts:24,34,46`

`MetadataRoute.Robots['rules']` is `Rule | Rule[]`; the cast asserts the object form. If `robots.ts` ever
returned the array form, `rules.allow` would be `undefined` and line 42 would pass silently — only the
sibling `toHaveLength` at line 39 keeps the file honest. `tracking-rewrites.test.ts:23-30` already shows the
house pattern: assert the shape, then narrow. One helper at the top removes all three.

### F7 — Low · the breaker lookup reaches through the type system · `services/api/src/common/config/env.schema.ts:421-429`

`services/api/tsconfig.json:20` sets `noUncheckedIndexedAccess: true`, so
`TRACKING_BASE_URL_BREAKERS[breaker]` types as `string | undefined`. It compiles clean with no cast, because
template literals accept `undefined` — so a hypothetical absent key yields a boot error reading `… the "@"
breaks the link: undefined.` rather than a compile error. Not reachable today: `breaker` provably comes from
`Object.keys` of the same object.

Not a type-safety violation, and the compile-pinned-`Record` convention does **not** transfer here — its point
is that a new union member fails typecheck, and these keys are ad-hoc characters, not a domain union.
`Readonly<Record<string, string>>` is the right type. Style only:

```ts
const found = Object.entries(TRACKING_BASE_URL_BREAKERS).find(([c]) => smsHost.includes(c));
if (found) { const [breaker, reason] = found; /* … */ }
```

### F8 — Low · both new checks are production-only, and hoisting them would cost nothing · `services/api/src/common/config/env.schema.ts:418-448`

`:365` is `if (env.NODE_ENV !== 'production') return;` and both new checks sit at `:421-448`, so a malformed
dev or CI value boots silently. The code comment argues the placement ("all three rules on this one variable
read as one block") and concedes the premise ("NOT production-only by necessity — nothing in dev legitimately
carries these either").

That premise is correct, and it cuts the other way: `http://localhost:3000` and a LAN IP both pass both new
checks, so hoisting them above `:365` catches an operator typo where the loop is fastest and refuses nothing
that works. `docs/runbooks/driver-device-day.md:211-214` is the one place a dev value produces a real-looking
SMS log.

A documented decision, so recorded rather than disputed. **If taken**, `const smsHost = …` (`:401`) moves up
with them — the breaker check reads it, and hoisting one without the other does not compile.

## Checks that came back clean

- **`http://` accepted in production is a non-issue.** I expected to flag it. `trackingLinkHost` strips
  `^https?://` and `trackingLink` emits `sakta.lv/r/<token>` with no scheme at all; the only non-gate readers
  are `ride-notifications.service.ts:66,137`, both feeding `trackingLink`. The scheme has zero effect on what
  the rider receives.
- **Port, IDN/punycode and percent-encoding are correctly absent from the breaker set.** A port resolves and
  is correctly charged against the 10-character budget. `.length` counts UTF-16 code units, which is exactly
  the unit the UCS-2 segment budget is denominated in, so an IDN host is measured correctly. A `%3F` in the
  *host* is already refused — `new URL` percent-decodes during host parsing and `?` is a forbidden host code
  point — and in the *path* it is a legitimate prefix the code documents as supported.
- **`robots.txt` does reach a crawler that only sees the short domain** — my own concern, refuted by the
  runbook. `hetzner-deploy.md:166-168`: *"because it **IS** the dispatch app's own origin, that gate
  constrains the dispatch domain itself — not a separate tracking host"*, and `:247`: *"Same origin as
  PUBLIC_TRACKING_BASE_URL — the dispatch app serves both."*
- **`expect(rules.allow).toBeUndefined()` is not a tautology.** It reddens the moment someone adds `allow:`
  to the literal, which is what its comment claims it guards. Same class as `tracking-page.test.tsx:191`,
  which correctly uses `toEqual` rather than `toMatchObject` so an added key also reddens.
- **No `public/robots.txt` conflict** — `apps/dispatch/public/` holds five SVGs, and the build lists
  `/robots.txt` as a route.
- **Neither new check early-returns**, with a test for exactly that (`https://sakta.lv/app?q=1`).
- **`/` is correctly absent from the breaker set** — a path prefix is a supported deployment the link builder
  preserves on purpose, pinned from both sides.
- **Hard rules**: no money, no ride-status write, no payment-method path, no provider SDK outside its slice,
  no contract duplicated outside `packages/shared` — `robots.ts` *derives* from the shared record rather than
  restating the prefixes. `packages/shared` unchanged, so no one-way-flow risk.
- **The `robots.txt` disclosure tradeoff is not a leak.** Disallowing a path advertises it, but `/t/`, `/r/`
  and `/e/` already travel in every rider SMS; the secret is the 16-character token, not the prefix.

**Forward-looking note, not a defect.** `Caddyfile` today has only the `{$API_DOMAIN}` block and
`compose.prod.yml` has no dispatch service, so `/robots.txt` is inert until #18/#19. Whoever lands them must
serve this Next app at the **root** of the domain — proxying only `/t/ /r/ /e/` would leave `/robots.txt` to
whatever else answers there, and this file would be dead without reddening anything. Worth a line on #18/#19.

## What is good

- **The mutation claim is real, and it is the half that usually is not.** "Nothing else would have caught its
  removal" is the exact sentence shape #137 shipped false. Here it is true: 1 failed, 271 passed.
- **`robots.ts` derives the disallow list from `TRACKING_PATH_BY_LANGUAGE`** rather than restating three
  prefixes, so a fourth language is disallowed the moment it can be minted. This is the contract seam being
  used, not merely not violated.
- **The rewrites are internal**, so `/r/<token>` and `/e/<token>` render `t/[token]` and inherit the same
  `generateMetadata` — all three public shapes get `noindex` from one line. Non-obvious and worth stating in
  the PR body.
- **The recorded decision *not* to add an `i` flag**, with the flipped verdict spelled out and a test pinning
  it either way, so it cannot be silently reversed.
- **`env.schema.spec.ts`'s `refusalMessages` helper and its explanation** — "a thrown `ZodError`'s message is
  the issue array JSON-stringified, so every quote arrives escaped and a pattern written the way the message
  reads cannot match" is the kind of thing that costs an hour once and never again.
- **The deliberate `s.lv` test hosts.** Choosing a 4-character host so the malformed forms are not refused for
  the *wrong* reason is what makes the suite prove what it claims — and it names why the bug looked narrower
  than it was.
- **Both #247 controls are described as requests a crawler may ignore**, with the token's TTL named as what
  actually bounds the damage. No overclaiming on a security control.

## Recommendation

**Approve.** Both tickets are delivered as specified and the evidence behind them holds under re-running.

Worth doing before merge, both cheap:

- **F1** — one regex in the block this PR already opened. The ticket did not ask for it, but "length is not a
  filter for shape" is this PR's own thesis, and a three-character blacklist is the second incomplete filter
  on this variable in two PRs.
- **F3** — one character in the PR body, which is the most-read surface and the only one not in the working
  tree.

**F2** folds into **#13** as a checklist line per the #250 deferral rule — it is in a file this PR does not
touch, and #13 already owns the boot-gate probe list. **F4–F8** are follow-ups; F4 and F5 pair naturally, both
one line in the same test file.
