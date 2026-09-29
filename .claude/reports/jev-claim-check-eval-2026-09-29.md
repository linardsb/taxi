# Jev claim-check eval — 2026-09-29

`observed` — `node .claude/skills/piv-create-pr/scripts/claim-check.mjs --eval .claude/skills/piv-create-pr/scripts/claim-check-labelled.jsonl`, run 2026-09-29T20:06Z at head `b801c7b` (the commit that added the set), model `jev-1.13.0` (from the response), exit 0, 3.1 s wall. Same set the questions were designed against during planning for some rows (`p-107`, `m-107`, `m-107-eta`, `w-87`): not held out.

Poor recall is recorded, not fixed: `QUESTIONS` were not edited after this run (plan Task 7).

```text
provenance (n=13: 6 true, 7 false)
  t     TP  FP  FN  TN  precision  recall
  0.3    6   5   0   2       0.55    1.00
  0.5    6   2   0   5       0.75    1.00
  0.7    4   1   2   6       0.80    0.67
  0.9    0   0   6   7          -    0.00

not_measured (n=11: 4 true, 7 false)
  t     TP  FP  FN  TN  precision  recall
  0.3    4   1   0   6       0.80    1.00
  0.5    2   1   2   6       0.67    0.50
  0.7    1   0   3   7       1.00    0.25
  0.9    0   0   4   7          -    0.00

worst_case (n=14: 7 true, 7 false)
  t     TP  FP  FN  TN  precision  recall
  0.3    2   0   5   7       1.00    0.29
  0.5    1   0   6   7       1.00    0.14
  0.7    0   0   7   7          -    0.00
  0.9    0   0   7   7          -    0.00

citation (n=12; rows = label, columns = Jev's choice)
                          supports     contradicts not_established
  supports                       4               0               1
  contradicts                    1               1               0
  not_established                0               1               4

Misses at threshold 0.5:
  m-107-reduction  not_measured  label true  got 0.42
  m-113-107  not_measured  label true  got 0.32
  m-138-693  not_measured  label false  got 0.55
  p-206-726  provenance  label false  got 0.65
  p-142-8s  provenance  label false  got 0.71
  w-139-nudge  worst_case  label true  got 0.13
  w-298-offer-state  worst_case  label true  got 0.19
  w-298-use-offers  worst_case  label true  got 0.18
  w-121-six-zones  worst_case  label true  got 0.33
  w-113-complete-diff  worst_case  label true  got 0.05
  w-99-throttle  worst_case  label true  got 0.16
  c-196r3-listen-539  citation  label not_established  got contradicts 0.83
  c-219-nudge-346  citation  label supports  got not_established 0.59
  c-265-ride-transitive  citation  label contradicts  got supports 0.98

observed 2026-09-29T20:06:22.246Z · model jev-1.13.0 · 50 rows · labelled-set blob a55775ce7e8b4694f720e70c88f1fad2386fc2ca · head b801c7b
```

## Rows the live selector never asks

`--eval` sends every row's question unconditionally. The body check does not. It asks `provenance` and
`not_measured` only when `observed` appears in the state, and never asks `worst_case` of an extreme-case sentence
or of a unit with no figure. Running each row's `state` through `findClaims` and `questionsFor` at `2b04bf6`
(observed, 2026-09-29) finds 10 rows whose question the tool would not ask. All 10 are labelled negatives:

- `provenance`: `p-206-numstat`, `p-206-726`
- `not_measured`: `m-138-693`, `m-206-probeB`, `m-142-gate`
- `worst_case`: `w-87`, `w-139-f6-per-tick`, `w-139-dark-latency`, `w-121-500-rows`, `w-236-75s`

Two of the misses above are among them: `p-206-726` (0.65) and `m-138-693` (0.55). Neither false positive can
occur in a body check. Recounted at threshold 0.5 over **in-path rows only** (`derived` from the table above:
remove each excluded row's cell; every excluded row not listed under Misses is a TN):

| Question | All rows: TP FP FN TN → P / R | In-path: TP FP FN TN → P / R |
|---|---|---|
| `provenance` | 6 2 0 5 → 0.75 / 1.00 | 6 1 0 4 → 0.86 / 1.00 |
| `not_measured` | 2 1 2 6 → 0.67 / 0.50 | 2 0 2 4 → 1.00 / 0.50 |
| `worst_case` | 1 0 6 7 → 1.00 / 0.14 | 1 0 6 2 → 1.00 / 0.14 |

`worst_case` recall stays 1 of 7 either way: the question misses docblock-style case-dependent figures. It is
recorded, not tuned (plan Task 7). The labels were not changed.
