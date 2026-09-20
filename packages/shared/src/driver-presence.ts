/**
 * How long a recorded driver position counts as proof of life.
 *
 * THREE SURFACES DECIDE "is this driver still reporting", and this is the one
 * number all three read:
 *
 * - the api drops a position older than this from `findNearby`, so a silent
 *   driver stops being a dispatch candidate;
 * - the presence sweeper marks a driver dark on the same boundary
 *   (`PRESENCE_DARK_AFTER_SECONDS`), so the durable record agrees with the
 *   dispatch filter rather than trailing it;
 * - the dispatch console tells Dina the stream has stopped
 *   (`board-state.ts`'s `driverFreshness`).
 *
 * A second copy in any of the three is the defect this file exists to prevent.
 * A console-local threshold in particular would put the board's «Raida» and
 * dispatch's candidacy on different clocks — Dina reading a driver as live
 * while the engine has already stopped offering to them, with every check
 * green and nothing to catch it.
 *
 * It lives here rather than in `services/api` because `apps/dispatch` cannot
 * import from a service (contracts flow one way through this package), and a
 * threshold two surfaces must agree on is a cross-surface contract like any
 * schema or enum.
 */
export const DRIVER_LOCATION_TTL_SECONDS = 60;
