# PR #244 review — give `PUSH_PROVIDER` the blank-line preprocess wrapper (#242)

**Head** `96863cf` · **Base** `main` @ `e1fc7f5` · round 1 · reviewed 2026-09-21

**Recommendation: request changes — minor.** No critical or high issues, and the **shipped behaviour is
correct**: the wrapper does what the PR says, changes exactly one input class, and cannot relax the
production gate. The gate is green on an independent run, and both of the PR body's mutation probes
reproduced exactly when I re-ran them rather than inheriting them.

Three Mediums, all of them claims rather than code, and all cheap. **M1** is the one worth a round: a
brand-new comment states a reason that the file it sits in contradicts eight lines below, and I
reproduced the contradiction. **M2** is the rule block's governing condition, which is not the test its
own `NODE_ENV` paragraph applies and which misdirects the next field. **M3** is a PR-body scope claim
that is false at the scope it names — and the PR body is the one surface no later commit sweeps.

The base has **not** moved. `git fetch origin && git rev-parse origin/main` → `e1fc7f5`, the same sha
the PR records as `baseRefOid`. First round, so neither the guarantees pass nor the fix-mechanism pass
applies. No plan artifact exists for #242 and the PR body says why, so the constraint pass is skipped —
correctly: #242's "Done when" is the specification, and both of its clauses are met.

| Severity | Count |
|---|---|
| Critical | **0** |
| High | **0** |
| Medium | 3 — M1 false reason in a new comment · M2 rule states the wrong governing condition · M3 false "repo-wide" scope claim |
| Low | 2 |

---

## Validation

`observed` — my own run, `/Users/Berzins/taxi-worktrees/wt-242` at `96863cf`, exit 0:

```
COMPOSE_PROJECT_NAME=taxi REDIS_PORT=6381 \
  DATABASE_URL=postgres://taxi:taxi@192.168.1.11:5432/taxi \
  REDIS_URL=redis://127.0.0.1:6381 REDIS_TEST_URL=redis://127.0.0.1:6381 \
  pnpm turbo run typecheck lint test build --force

Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m26.41s
```

| Check | Result |
|---|---|
| Gate, all 22 tasks (typecheck · lint · test · build, `--force`) | ✅ 22/22, exit 0 |
| `@taxi/api` | ✅ `Test Suites: 80 passed, 80 total` · `Tests: 772 passed, 772 total` |
| Redis-gated suites | ✅ **0 skipped** — `REDIS_TEST_URL` was set, so the 39 gated tests ran |
| PR checks (`check` · `codeql` · `CodeQL` · `audit-diff` · `ready`) | ✅ all 5 green (`gh pr checks 244`) |

Task count 22 matches the gate's own expected figure. The per-package rows in the PR body are not
re-stated here: my capture was piped through `tail`, so only the `@taxi/api` summary and the turbo
total survived it. Both match the body exactly, and `22 successful` is the authoritative statement that
every other package's test task passed.

### The PR body's figures, re-derived

Every figure checked against a run rather than copied. All hold except M3.

| Figure | Claimed | Verdict |
|---|---|---|
| `@taxi/api` 772 tests / 80 suites / 0 skipped at head | `observed` | ✅ reproduced in my gate run |
| Base `e1fc7f5` = 770; delta is exactly the two new cases | `observed`, two invocations | ✅ sound. The branch is a **single commit**, so the body's "`HEAD~1` checked out" *is* the base: `git rev-parse 96863cf~1` → `e1fc7f5` = `origin/main`. The diff adds two `it(` blocks and removes none, so `772 − 2 = 770` is independently derivable and the cross-invocation comparison is clean |
| Diff totals 76 / 13 across 3 files | `observed` | ✅ `42+29+5 = 76`, `6+0+7 = 13`, matches `gh pr view --json additions,deletions` |
| `env.schema.ts` 351 → 387 · `sms-env.schema.ts` 315 → 313 | `observed` (`wc -l`) | ✅ 387 and 313 observed; net `+36` / `−2` match the diff. Both far under the 500-line cap; the spec (560) is exempt per #112 |
| Exactly four `.enum(` sites in `services/api/src/common/config/`, all four carrying a default | `observed`, scope stated | ✅ `NODE_ENV` (`:54`), `ALLOW_STUB_MAPS_PROVIDER` (`:249`), `PUSH_PROVIDER` (`:298`), `SMS_PROVIDER` (`sms-env.schema.ts:242`). Correctly scoped in the body |
| Three `z.preprocess` sites after this lands | implied by "the three provider switches" | ✅ `env.schema.ts:247`, `:296`, `sms-env.schema.ts:234` |
| `docs/runbooks/hetzner-deploy.md` documents `PUSH_PROVIDER` unset and removed, unchanged by this | `observed` | ✅ §3 (`:216`) and §8.3 (`:814`) both stay true — unset still yields `stub`, which the factory still refuses |
| "The repo-wide `z.enum` sites … carry no `.default()`" | `observed`-flavoured | ❌ **M3** — false at the scope named |

### The two mutation probes, re-run

The PR body's probe table is exactly the kind of claim this repo inherits unaudited, so I restored the
file and re-ran each mutation myself (`npx jest src/common/config/env.schema.spec.ts` from
`services/api`, once per mutation, `git checkout --` after each; `git status` clean at `96863cf`
afterwards).

| Probe | Body claims | I observed |
|---|---|---|
| `PUSH_PROVIDER` wrapper removed | `1 failed, 41 passed, 42 total` — the new case alone | ✅ identical; the failure is `envSchema PUSH_PROVIDER (#14) › reads a blanked line as unset rather than refusing to boot (edge — #242)` |
| A wrapper added to `NODE_ENV` | `1 failed, 41 passed, 42 total` — the guard case alone | ✅ identical; the failure is `envSchema NODE_ENV (#242) › refuses a blanked line rather than falling back to development (failure)` |

Both bite. The `NODE_ENV` guard is not decorative: with a wrapper, `prod({ NODE_ENV: '' })` falls back to
`development`, the `superRefine` returns at `env.schema.ts:336` before any secret check, the parse
succeeds — which is precisely the silent-gates outcome the block warns about.

### Behaviours no test in the diff pins, run directly

Through a throwaway spec inside `services/api/src/common/config/`, deleted afterwards; worktree verified
clean at `96863cf`.

| Case | Result |
|---|---|
| `PUSH_PROVIDER: 'fcm'` | still refused; issue path `["PUSH_PROVIDER"]`, code `invalid_enum_value` — `z.preprocess` does **not** move or flatten the path |
| `PUSH_PROVIDER: '  '` (whitespace) | still refused, same path — the wrapper matches `''` exactly, as its siblings do |
| `PUSH_PROVIDER: ''` · `PUSH_PROVIDER` absent | both → `'stub'`, indistinguishable, which is the whole point |
| Blanked `ALLOW_STUB_MAPS_PROVIDER=` in production → `mapsProviderSourceFactory` | throws `No production MapsProvider is bound: StubMapsProvider prices rides off straight-line distance … Fix every gap named …` — the new absolute claim at `env.schema.ts:241-245` holds |

The wrapper's central safety claim — a blanked line cannot cost the operator the gate — is backed across
two spec files: `env.schema.spec.ts:351-356` pins blank → `stub`, `push.module.spec.ts:27-33` pins
production + `stub` → `No production PushProvider is bound`. No single test links them, but the seam is a
pure value hand-off, so nothing can slip between them, and `PushModule` really is in the boot graph
(`drivers.module.ts:33`).

---

## Medium

### M1 — the new `SMS_PROVIDER` pointer states a reason the same file contradicts eight lines below

`services/api/src/common/config/sms-env.schema.ts:235-239` (and, in blanket form,
`services/api/src/common/config/env.schema.ts:11-12`)

The new comment says:

> a blanked `SMS_PROVIDER=` line would otherwise deliver `''` and refuse to boot in EVERY environment
> **with a generic enum message**.

The first half is true. The second is false for this field, and `sms-env.schema.ts:243-252` is where it
is falsified: `SMS_PROVIDER`'s enum carries a custom `message`, and the comment at `:247-248` records
that `{ message }` is the spelling zod 3.25.76 honours for an **out-of-range enum value** — which is what
`''` is, since `''` is a string, so `ZodEnum` raises `invalid_enum_value`, not `invalid_type`.

`observed` — I removed the `SMS_PROVIDER` wrapper and parsed a blanked line. Both the blanked value and a
bogus one produce the **custom** message, byte-identical:

```
SMS blank (wrapper removed) :
  [{"path":["SMS_PROVIDER"],"code":"invalid_enum_value",
    "msg":"SMS_PROVIDER must be one of: stub | twilio | bulkgate | budgetsms. 'auto' was retired
           (#137) — name the provider outright; 'stub' delivers nothing and production refuses it."}]

SMS bogus ('vonage', wrapper removed) : …the same message…
```

(Throwaway spec under `services/api/src/common/config/`, file restored with `git checkout --`,
`git status` clean at `96863cf` afterwards.)

So un-wrapped, a blanked `SMS_PROVIDER=` never produced a message that "names no remedy" — it produced
one that names the four legal values and the consequence of each. The generic-message problem was
`PUSH_PROVIDER`'s alone, which is the whole of #242, and the PR's own framing ("a worse failure than the
SMS one #137 closed") is groping at this without naming it. The wrapper is still right for
`SMS_PROVIDER` — a blank refusing the boot in dev and test at all is a real cost — but the reason
written down for it is not the reason.

This matters more than a wording slip because the sentence is the **canonical** statement. #242's whole
purpose was to replace three site-local explanations with one governing one; a canonical statement that
is false for one of the three fields it governs reproduces the defect it was written to close.

**Two sites, not three.** `env.schema.ts:11-12` inherits the same claim in blanket form ("An un-wrapped
`z.enum` then refuses to boot in EVERY environment with zod's generic enum message, which names no
remedy"), scoped by `:6-7` to "the enums in this file and its SMS sibling" — true for `NODE_ENV`,
`ALLOW_STUB_MAPS_PROVIDER` and `PUSH_PROVIDER`, false for `SMS_PROVIDER`. **The PR body is clean** — I
checked. Its version (body lines 5-7) is scoped to `PUSH_PROVIDER` specifically, where the claim is true
and I observed it: `Invalid enum value. Expected 'stub' | 'expo', received 'fcm'`. No edit needed there.

**Fix — both sites in one pass:**

1. `sms-env.schema.ts:237-238` — "…would otherwise deliver `''` and refuse to boot in EVERY environment.
   Here that refusal arrives through this enum's own custom `message` below rather than the generic one
   `PUSH_PROVIDER` got (#242), so what the wrapper removes for this field is the refusal, not the
   silence."
2. `env.schema.ts:11-12` — qualify the blanket sentence: "…with zod's generic enum message, which names
   no remedy — unless the enum carries a custom `message`, as `SMS_PROVIDER` does, in which case only
   the refusal is the cost."

### M2 — the rule block's governing condition is not the test its own `NODE_ENV` paragraph applies, and its roster expires at #134

`services/api/src/common/config/env.schema.ts:17-22`

> APPLIED TO THE THREE PROVIDER SWITCHES, and to them because **their default is itself the value
> production refuses**: `ALLOW_STUB_MAPS_PROVIDER` (`false`), `PUSH_PROVIDER` (`stub`) and
> `SMS_PROVIDER` (`stub`, in `sms-env.schema.ts`).

Read literally, the condition discriminates the four fields correctly *today* — I checked, and
`ALLOW_STUB_MAPS_PROVIDER=false` really does refuse the production boot (`observed`, table above). The
`code-reviewer` agent weighed this and called it sound on that basis. I am keeping it as a finding
anyway, because a rule is judged by what it tells the next reader to do, not by whether it sorts today's
four members. On that test it fails twice.

**It has the polarity backwards for one member, and the coincidence has a due date in the code.** For
push and SMS, `stub` is the *unsafe* value the factory throws on. For maps, `false` is the *conservative*
value — the thrown message says so itself: *"set ALLOW_STUB_MAPS_PROVIDER=**true** to accept that until
#134 binds OsrmMapsProvider"*. `true` is what widens what production accepts. `false` refuses today only
because `StubMapsProvider` is the only routes provider in the tree, and both `env.schema.ts:239` and
`geo.module.ts:31` say #134 deletes the switch and the clause together. Applied as written, the condition
then tells the author of the next `ALLOW_*`/`ENABLE_*` flag — one whose `false` default production simply
accepts — *not* to wrap it, and a blanked line refuses the boot everywhere with a generic message. That
is the defect #242 exists to close, reissued by its own rule.

**The `NODE_ENV` exception is argued from a different test than the one stated as governing.** The
paragraph at `:24-30` says, correctly, that blank-as-unset there "would turn one stray keystroke on a
real host into a clean boot with every gate off". That is the conservative-default test. As stated, the
first condition cannot even be *evaluated* for `NODE_ENV`: `development` is not a value production
refuses, it is the value that makes there be no production. The block presents a sound argument as an
instance of a condition that does not apply — so a later reader who trusts the stated condition over the
paragraph gets the wrong answer, and a later reader who trusts the paragraph learns the rule was
mis-stated.

**The roster also goes stale silently.** `:17-20` hardcodes "THE THREE" and names all three. When #134
lands, the site comment at `:240-244` leaves with the field it annotates; this block does not, and
nothing points a #134 implementer at it. `env.schema.ts:239` names two edit sites and this is not one of
them.

**Fix.** Restate the condition as the property, with the roster as an example rather than a count. One
edit closes both halves and survives #134:

> APPLIED TO EVERY ENUM HERE WHOSE DEFAULT IS THE CONSERVATIVE VALUE — the one that cannot silently
> widen what production accepts. Today that is `ALLOW_STUB_MAPS_PROVIDER` (`false` withholds the
> acceptance; while the stub is the only routes provider, that also refuses the boot outright),
> `PUSH_PROVIDER` (`stub`, which the push factory refuses in production) and `SMS_PROVIDER` (`stub`,
> likewise, in `sms-env.schema.ts`).

Then at `:24` justify `NODE_ENV` under that same wording rather than as a carve-out: it is not a field
production evaluates, it is the field that **selects** whether production's rules run at all, so its
default can never be the conservative value. Paragraph four then reads as an instance of the rule.

Optional, same edit: `ALLOW_STUB_MAPS_PROVIDER` is not a "provider switch" in the sense the other two are
— it selects no provider, it accepts a gap. "The three env switches" costs nothing and stops the list
implying a symmetry that is not there.

### M3 — the PR body's "repo-wide" enum claim is false at the scope it names

PR body, the `NODE_ENV` paragraph:

> The repo-wide `z.enum` sites outside it (`auth.service.ts:45`, three `languageSchema` uses,
> `expo-push.provider.ts:27`) are not env fields and carry no `.default()`, so the rule has no bearing
> on them.

That enumeration is exactly the `services/api/src` set, not the repo. `observed` —
`grep -rn "\.enum(" services/*/src packages/*/src apps/*/src db/src`, excluding `node_modules`, `dist`
and spec files — `packages/shared/src` holds at least **eight** `z.enum(…).default(…)` sites:

| File:line | Field |
|---|---|
| `realtime-events.ts:96` | `previousStatus: z.enum(RIDE_STATUSES).nullable().default(null)` |
| `schemas/vehicle.ts:11` | `category: z.enum(RIDE_CATEGORIES).default('standard')` |
| `schemas/platform-config.ts:38` | `defaultDispatchMode: z.enum(DISPATCH_MODES).default('auto_match')` |
| `schemas/driver.ts:12` | `status: z.enum(DRIVER_STATUSES).default('offline')` |
| `schemas/driver.ts:14` | `spokenLanguages: z.array(z.enum(LANGUAGES)).default(['lv'])` |
| `schemas/user.ts:14` | `language: z.enum(LANGUAGES).default('lv')` |
| `schemas/ride.ts:80` | `category: z.enum(RIDE_CATEGORIES).default('standard')` |
| `schemas/ride.ts:263` | `bookingChannel: z.enum(BOOKING_CHANNELS).default('app')` |

The **conclusion survives** — none of those is an env field, so the rule genuinely has no bearing on them
— but the evidence offered for it does not, and it is offered in the most-read surface and the only one
no later commit sweeps. A future consistency pass told "repo-wide, none carry a default" has been handed
a false premise for skipping an audit.

**Fix.** In the PR body, change "The repo-wide `z.enum` sites outside it" to "The other `z.enum` sites in
`services/api/src`", and drop "and carry no `.default()`" — the "not env fields" half carries the whole
argument and is true at any scope. The in-code claim at `env.schema.ts:24-25` ("the fourth and last enum
carrying a default across the two files") is correctly scoped and needs no change.

---

## Low

### L1 — `PUSH_PROVIDER` still answers a *mistyped* value with the generic message the PR objects to

`services/api/src/common/config/env.schema.ts:298` · `observed`

The PR's stated grievance is a message that "names no remedy". The wrapper fixes that for a blanked
line. A mistyped one still gets it:

```
PUSH_PROVIDER=fcm     → Invalid enum value. Expected 'stub' | 'expo', received 'fcm'
PUSH_PROVIDER='expo ' → Invalid enum value. Expected 'stub' | 'expo', received 'expo '
```

`SMS_PROVIDER` solved exactly this at `sms-env.schema.ts:243-252` — which is *why* M1's claim is false
for it. The trailing-space case bites hardest: same class of hand-edited dotenv slip #242 is about, and
the rendered message puts the offending character somewhere invisible.

Not a regression and outside #242's "Done when", so not a merge blocker — but it is where "the
inconsistency just moves" next. Note it interacts with M1: giving `PUSH_PROVIDER` a custom message makes
the rule block's "generic enum message" premise false for all three switches, so **if L1 is taken, M1's
fix should be the stronger wording** — the cost a blank imposes is the *refusal*, and the generic message
is one field's aggravating circumstance rather than the rule's basis.

**Fix (follow-up issue, not this PR).** `{ message: "PUSH_PROVIDER must be one of: stub | expo. 'stub'
delivers nothing and production refuses it (#14)." }`

### L2 — the `NODE_ENV` guard passes on any throw, so it can stop guarding silently

`services/api/src/common/config/env.schema.spec.ts:375`

`expect(() => envSchema.parse(prod({ NODE_ENV: '' }))).toThrow()` — no matcher. **It works today**: I ran
the mutation and it goes red for the right reason. Bare `.toThrow()` also has five precedents in this
same file (`:293`, `:313`, `:362`, `:467`, `:558`), so this is a strengthening suggestion, not a
deviation.

The reason to strengthen this one specifically is its job: it exists to survive a future consistency pass
that no one has written yet. It passes on *any* throw, so it stops guarding the moment `prod()` gains a
value that fails for an unrelated reason — and nothing would report that it had.

**Fix.** Assert the path rather than a message regex — zod's default message text is not a stable
contract across a version bump, and `|` would need escaping:

```ts
const result = envSchema.safeParse(prod({ NODE_ENV: '' }));
expect(result.success).toBe(false);
expect(result.error?.issues).toContainEqual(
  expect.objectContaining({ path: ['NODE_ENV'], code: 'invalid_enum_value' }),
);
```

---

## Checked and clean

Recorded so the next round does not re-derive them.

- **Retired-claim sweep.** `sms-env.schema.ts`'s old parenthetical — *"(`PUSH_PROVIDER` is the un-wrapped
  precedent and is left alone — it is outside #137's diff.)"* — is gone, which is the claim this PR
  falsifies. `grep -rn "un-wrapped\|unwrapped\|precedent and is left alone\|outside #137"` over
  `services/ packages/ docs/` returns three hits, all past-tense and correct (`env.schema.ts:10`, `:291`,
  `env.schema.spec.ts:345`). Nothing stale survives.
- **`docs/runbooks/hetzner-deploy.md` was rightly left alone**, and should stay that way. §8.3 is an
  *Observed* table whose rows come from real container boots (`:254-263`, and the pr-147 round-2 record);
  adding a "blank" row by inference would be #107's defect verbatim. The existing "unset" row is still
  true and covers the absent-key spelling. If the blank spelling is wanted there, it needs a boot.
- **`.env.example` needs no edit** — `:137` commits `PUSH_PROVIDER=stub`, and neither already-wrapped
  sibling (`:89`, `:111`) documents blank-as-unset there either. Silence is the consistent choice.
- **Type impact is nil.** `z.preprocess` widens only the *input* type; `Env = z.infer<…>` is the output,
  so `Env['PUSH_PROVIDER']` stays `'stub' | 'expo'` and `push.module.ts:17`'s narrowing compiles
  unchanged. Nothing in `services/`, `packages/` or `apps/` takes `z.input<typeof envSchema>`
  (`observed`, grep), and typecheck is green across all 22 gate tasks.
- **Helper resolution in the new cases is correct**, worth stating because the spec has three shadowing
  `dev` helpers (`:168`, `:320`, `:380`). The PUSH blank case takes the `describe`-local `dev` at `:320`
  and the top-level `prod` at `:19`; the `NODE_ENV` describe declares no shadow, so `:375` gets the
  top-level `prod`. Both are what the cases intend.
- **Test-shape rule.** The new `NODE_ENV` describe carries only a failure case, which is fine rather than
  a gap: the accepted values are covered at `:73-81` and by every `prod()` case in the file.
- **Standards.** The change stays inside `common/config/`; config is API-local, not a cross-surface
  contract, so it correctly does not move to `@taxi/shared`. No `any`, no `as`, no `@ts-ignore`, no
  `max-lines` disable. No user-facing strings, money, ride-status writes or provider SDK imports touched.

---

## What is good

- **The scope call is the right one and it is argued, not asserted.** #242 offered two exits; wrapping is
  correct, because the alternative makes three fields refuse a blank line to fix one field's
  inconsistency, and the block says so.
- **The `NODE_ENV` exception is the part most passes would have got wrong**, and it ships with a guard
  test whose comment tells the next reader not to "fix" it. That test fails under exactly the mutation it
  is written against — I ran it. Writing an exception down and then defending it with a failing case is
  more than the ticket asked for, and M2 is a quarrel with the wording of a judgement that is itself
  correct.
- **Both new cases were probed by reverting the code they cover**, and both reverts reproduced on my
  independent run. That is the standard `taxi-review-payoffs-are-claims` exists to enforce, met before
  review rather than after.
- **The duplicate explanations were removed, not merely supplemented.** `sms-env.schema.ts` is two lines
  *shorter* and `ALLOW_STUB_MAPS_PROVIDER`'s comment is a pointer. The common failure here is adding a
  canonical statement and leaving all three copies standing; this did not do that.
- **The retired claim was retired by subject, not by digit** — the one sentence in the tree that this PR
  falsifies was found and deleted in the same commit.
- **The behavioural delta is exactly one input class**, and it holds up under direct probing: absent key,
  whitespace, unknown value, error path and error code are all unchanged.

---

## Recommendation

**Request changes — minor.** No critical or high issues; the gate is green on an independent run; the
shipped behaviour matches the PR's description and closes both clauses of #242's "Done when". Nothing
here touches correctness.

M1 is the one worth a round: the PR's central deliverable is a canonical statement of a rule, and it is
false for one of the three fields it governs — in a repo whose CLAUDE.md grades exactly that, and where
the falsifying evidence is eight lines below the claim. M2 and M3 are single-edit corrections. M3 should
not be skipped because the PR body is the only surface a later commit cannot sweep.

Suggested order: **M1** (both in-code sites; the PR body needs no edit — verified) → **M2** → **M3** →
L2 if it is riding along. L1 is a follow-up issue, not work for this PR.

Next: `piv-fix-review-findings` on this report, then re-run validation. A human reviews the code plus
this review and merges.
