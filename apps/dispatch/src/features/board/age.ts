/**
 * mm:ss since an ISO instant — digits only, so nothing here needs translating.
 *
 * Its own module rather than a shared export from `ride-queue.tsx`: the driver
 * list needs the same formatter, and importing it from the queue would drag
 * `@/features/override` and `@/features/zones` into the list's module graph
 * for ten lines of arithmetic.
 *
 * NO HOURS FIELD, deliberately: three hours renders `180:00`, not `03:00:00`.
 * Unbounded silence is real for an `on_ride` driver — nothing sweeps them
 * offline — and the minute count is the number that says how bad it is. A cap
 * («>59:59») would throw that away, and a second formatter is not worth a case
 * a dispatcher should never let happen.
 *
 * BOTH OPERANDS ARE THE API'S CLOCK (#238). `at` comes off the wire, so the
 * "now" subtracted from it has to be the server's too — `useBoard`'s
 * `serverNowMs`, never a raw `Date.now()`. The parameter name is the only
 * thing enforcing that; both are `number`. `Math.max(0, …)` then HIDES the
 * most visible symptom of getting it wrong — a browser running slow yields a
 * negative age and the clamp prints `00:00` on every row rather than anything
 * that looks broken — which is why this is worth stating here instead of
 * leaving it to the call sites to notice.
 */
export function ageOf(serverNowMs: number, at: string): string {
  const totalSeconds = Math.max(
    0,
    Math.floor((serverNowMs - Date.parse(at)) / 1000),
  );
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
