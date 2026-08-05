/**
 * The engine's ONLY route to a strategy.
 *
 * `.claude/references/dispatch-strategies.md` forbids one thing outright: "the
 * engine must never import a concrete strategy directly". Injecting this token
 * rather than `AutoMatchStrategy`/`GeozoneQueueStrategy` is what makes that
 * structural instead of a convention.
 */
export const DISPATCH_STRATEGY_RESOLVER = 'DISPATCH_STRATEGY_RESOLVER';
