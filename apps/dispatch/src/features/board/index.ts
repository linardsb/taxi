/**
 * The board slice's public API — the /dispatch page composes exactly these.
 */
export { AlertsPanel } from './alerts-panel';
export { BoardMap } from './board-map';
export { isStale } from './board-state';
export type { BoardAlert, BoardState, PillState } from './board-state';
export { ConnectionPill } from './connection-pill';
export { RideQueue } from './ride-queue';
export { useBoard } from './use-board';
