/**
 * The effect runner every reducer-driven provider shares: a decision's
 * effects, executed in order, one at a time. A throw ends the chain and is
 * reported ONCE through `onThrow` — uncaught, a native or network failure
 * left `busy` set with nothing to clear it. `run` may answer `'stop'`: the
 * effect's own answer already decided against the rest of the chain, and
 * carrying on would rebuild what was just torn down (presence review F32).
 *
 * Generic over the effect type so `availability`, `offers` and `active-ride`
 * run the same loop without importing each other (#15 — the slices must not
 * form a cycle: `availability` renders `offers`' views, `offers` opens
 * `active-ride`).
 */
export async function runEffects<E>(
  effects: E[],
  run: (effect: E) => Promise<void | 'stop'>,
  onThrow: (error: unknown) => void,
): Promise<void> {
  for (const effect of effects) {
    try {
      if ((await run(effect)) === 'stop') return;
    } catch (error) {
      onThrow(error);
      return;
    }
  }
}
