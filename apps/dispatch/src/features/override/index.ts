/**
 * The override slice's public API — the /dispatch page composes exactly these,
 * plus the pure helpers `ride-queue` needs to decide which affordance a row
 * gets.
 */
export { AssignDialog } from './assign-dialog';
export { assignVerb, pickupZoneOf } from './assign-state';
export type { AssignVerb } from './assign-state';
export { CancelDialog } from './cancel-dialog';
/**
 * Exported for #19's booking form, which is a modal on the same screen and must
 * trap focus and close on Escape identically. A second shell would be a second
 * place where "can a dispatcher on a call get stuck in a dialog" is decided.
 */
export { DialogShell, dialogButtonStyle } from './dialog-shell';
export { RideRowActions } from './row-actions';
export { useAssign } from './use-assign';
