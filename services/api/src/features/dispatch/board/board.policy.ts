/**
 * Board policy. Engine pacing only — the config-not-constant rule from
 * dispatch.policy.ts holds here too: nothing in this file is a promise Dina
 * can change without a deploy, because nothing in it is a business knob.
 */

/**
 * How often a full board frame is pushed to the dispatch room.
 *
 * 2 s keeps ride-STATUS freshness on the board at ≤ ~2 s + delivery
 * (`derived`: one cadence interval, assuming build+emit complete within it).
 * The ≤2 s *unclaimed* AC is deliberately NOT carried by this cadence —
 * `dispatch:unclaimed` is event-driven off the 1 s sweeper, worst case
 * ≈ 1 s sweep + delivery (`derived` from SWEEP_INTERVAL_MS = 1_000, assuming
 * a healthy sweeper). The cadence also doubles as the client's staleness
 * heartbeat: its pill stops claiming «Tiešraide» after two missed frames.
 */
export const BOARD_EMIT_INTERVAL_MS = 2_000;

/**
 * Safety valve on the rides read, not a pagination scheme. Pilot target is
 * ~100 rides/WEEK (`expected`, epic §7), so live rides are single digits and
 * this cap should never bind; if it ever does, the board shows the oldest 100
 * and the read stays bounded.
 */
export const BOARD_RIDES_LIMIT = 100;
