/** The effect runner: a decision's effects, executed in order, one at a time. */
import type { Effect } from './presence-state';

/**
 * Runs a decision's effects in order, one at a time. A throw ends the chain
 * and is reported ONCE through `onThrow` — uncaught, a SecureStore or
 * permission failure left `busy` set with nothing to clear it and every
 * toggle press ignored. `run` may answer `'stop'`: the effect's own answer
 * already decided against the rest of the chain (a refused `put_status`,
 * whose `flipOffline` tore down inside the dispatch), and carrying on would
 * rebuild what was just torn down (review F32).
 */
export async function runEffects(
  effects: Effect[],
  run: (effect: Effect) => Promise<void | 'stop'>,
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
