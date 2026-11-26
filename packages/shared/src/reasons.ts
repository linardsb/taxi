import type { MessageKey } from './i18n/lv';

/**
 * The compliance record layer's vocabulary (#316, architecture K1/K2).
 *
 * Every tuple here is a written-out literal, never a `.filter()` of another:
 * `@taxi/db` builds pg enums from them, and a code that reached a stored
 * `ride_events` row can never be renamed or removed — only added to (an
 * `ALTER TYPE`), because those rows are protected records under
 * Autopārvadājumu likums 35.² (5).
 */

/** What a `ride_events` row records. `status` rows are the only ones VID reads. */
export const RIDE_EVENT_KINDS = [
  'created',
  'status',
  'assigned',
  'released',
] as const;
export type RideEventKind = (typeof RIDE_EVENT_KINDS)[number];

/** Who caused an event. `admin` is recorded distinctly even where the ride status collapses it to dispatcher. */
export const RIDE_EVENT_ACTORS = [
  'rider',
  'driver',
  'dispatcher',
  'admin',
  'system',
] as const;
export type RideEventActorKind = (typeof RIDE_EVENT_ACTORS)[number];

/** Every reason code, cancel and decline — the `ride_reason_code` pg enum. */
export const RIDE_REASON_CODES = [
  'rider_changed_plans',
  'rider_wait_too_long',
  'rider_booked_by_mistake',
  'rider_other',
  'driver_rider_no_show',
  'driver_vehicle_problem',
  'driver_safety_concern',
  'driver_other',
  'dispatcher_rider_request',
  'dispatcher_duplicate_booking',
  'dispatcher_no_driver_available',
  'dispatcher_rider_no_show',
  'dispatcher_other',
  'system_no_driver_found',
  'decline_too_far',
  'decline_unwanted_destination',
  'decline_vehicle_unsuitable',
  'decline_on_break',
  'decline_other',
] as const;
export type RideReasonCode = (typeof RIDE_REASON_CODES)[number];

/**
 * Cancel reasons per cancelling actor. Admin cancels use the `dispatcher` list,
 * matching the `cancelled_by_dispatcher` status they produce.
 */
export const CANCEL_REASONS = {
  rider: [
    'rider_changed_plans',
    'rider_wait_too_long',
    'rider_booked_by_mistake',
    'rider_other',
  ],
  driver: [
    'driver_rider_no_show',
    'driver_vehicle_problem',
    'driver_safety_concern',
    'driver_other',
  ],
  dispatcher: [
    'dispatcher_rider_request',
    'dispatcher_duplicate_booking',
    'dispatcher_no_driver_available',
    'dispatcher_rider_no_show',
    'dispatcher_other',
  ],
  system: ['system_no_driver_found'],
} as const satisfies Record<
  'rider' | 'driver' | 'dispatcher' | 'system',
  readonly RideReasonCode[]
>;
export type CancelReasonActor = keyof typeof CANCEL_REASONS;
export type CancelReasonCode =
  (typeof CANCEL_REASONS)[CancelReasonActor][number];

/** The 14 cancel codes as one literal tuple, for `z.enum`. Pinned to `CANCEL_REASONS` by `tests/reasons.test.ts`. */
export const CANCEL_REASON_CODES = [
  'rider_changed_plans',
  'rider_wait_too_long',
  'rider_booked_by_mistake',
  'rider_other',
  'driver_rider_no_show',
  'driver_vehicle_problem',
  'driver_safety_concern',
  'driver_other',
  'dispatcher_rider_request',
  'dispatcher_duplicate_booking',
  'dispatcher_no_driver_available',
  'dispatcher_rider_no_show',
  'dispatcher_other',
  'system_no_driver_found',
] as const satisfies readonly CancelReasonCode[];
// The reverse direction: every CancelReasonCode is in the tuple.
const _cancelCodesComplete: readonly (typeof CANCEL_REASON_CODES)[number][] =
  [] as CancelReasonCode[];
void _cancelCodesComplete;

/** Why a driver declined an offer. Stored on the offer row (`decline_reason`) and on the ride event. */
export const DECLINE_REASONS = [
  'decline_too_far',
  'decline_unwanted_destination',
  'decline_vehicle_unsuitable',
  'decline_on_break',
  'decline_other',
] as const satisfies readonly RideReasonCode[];
export type DeclineReasonCode = (typeof DECLINE_REASONS)[number];

export function isCancelReasonFor(
  actor: CancelReasonActor,
  code: CancelReasonCode,
): boolean {
  return (CANCEL_REASONS[actor] as readonly CancelReasonCode[]).includes(code);
}

/** `*_other` needs free text — a stored "other" with nothing said is no reason (D2). */
export function reasonNeedsText(code: RideReasonCode): boolean {
  return code.endsWith('_other');
}

/** Label key per code. A code without a string is a compile error here. */
export const REASON_LABEL_KEYS: Record<RideReasonCode, MessageKey> = {
  rider_changed_plans: 'reason.rider_changed_plans',
  rider_wait_too_long: 'reason.rider_wait_too_long',
  rider_booked_by_mistake: 'reason.rider_booked_by_mistake',
  rider_other: 'reason.rider_other',
  driver_rider_no_show: 'reason.driver_rider_no_show',
  driver_vehicle_problem: 'reason.driver_vehicle_problem',
  driver_safety_concern: 'reason.driver_safety_concern',
  driver_other: 'reason.driver_other',
  dispatcher_rider_request: 'reason.dispatcher_rider_request',
  dispatcher_duplicate_booking: 'reason.dispatcher_duplicate_booking',
  dispatcher_no_driver_available: 'reason.dispatcher_no_driver_available',
  dispatcher_rider_no_show: 'reason.dispatcher_rider_no_show',
  dispatcher_other: 'reason.dispatcher_other',
  system_no_driver_found: 'reason.system_no_driver_found',
  decline_too_far: 'reason.decline_too_far',
  decline_unwanted_destination: 'reason.decline_unwanted_destination',
  decline_vehicle_unsuitable: 'reason.decline_vehicle_unsuitable',
  decline_on_break: 'reason.decline_on_break',
  decline_other: 'reason.decline_other',
};
