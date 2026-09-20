/**
 * The board slice's public API — the /dispatch page composes exactly these.
 */
export { AlertsPanel } from './alerts-panel';
export { BoardMap } from './board-map';
export { driverFreshness, isStale } from './board-state';
export type {
  BoardAlert,
  BoardState,
  DriverFreshness,
  PillState,
} from './board-state';
export { ConnectionPill } from './connection-pill';
export { DriverList } from './driver-list';
export { RideQueue } from './ride-queue';
export { useBoard } from './use-board';
