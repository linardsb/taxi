/**
 * The effect runner, typed to this slice's `Effect`. The loop itself moved
 * to `@/lib/run-effects` in #15 so `offers` and `active-ride` run the same
 * one without importing this slice (which renders theirs — a cycle).
 */
import { runEffects as runGeneric } from '@/lib/run-effects';
import type { Effect } from './presence-state';

export function runEffects(
  effects: Effect[],
  run: (effect: Effect) => Promise<void | 'stop'>,
  onThrow: (error: unknown) => void,
): Promise<void> {
  return runGeneric(effects, run, onThrow);
}
