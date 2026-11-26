import type { lvReasons } from './lv-reasons';

/** English reason labels and console cancel picker strings (#316) — see `lv-reasons.ts`. */
export const enReasons = {
  'reason.rider_changed_plans': 'Plans changed',
  'reason.rider_wait_too_long': 'Wait too long',
  'reason.rider_booked_by_mistake': 'Booked by mistake',
  'reason.rider_other': 'Other reason',
  'reason.driver_rider_no_show': 'Rider did not show up',
  'reason.driver_vehicle_problem': 'Vehicle problem',
  'reason.driver_safety_concern': 'Safety concern',
  'reason.driver_other': 'Other reason',
  'reason.dispatcher_rider_request': 'Rider asked to cancel',
  'reason.dispatcher_duplicate_booking': 'Duplicate booking',
  'reason.dispatcher_no_driver_available': 'No driver available',
  'reason.dispatcher_rider_no_show': 'Rider did not show up',
  'reason.dispatcher_other': 'Other reason',
  'reason.system_no_driver_found': 'No driver found',
  'reason.decline_too_far': 'Too far',
  'reason.decline_unwanted_destination': 'Unwanted destination',
  'reason.decline_vehicle_unsuitable': 'Vehicle unsuitable',
  'reason.decline_on_break': 'On a break',
  'reason.decline_other': 'Other reason',
  'console.cancel_reason_code': 'Reason',
  'console.cancel_reason_placeholder': 'Choose a reason',
  'console.cancel_reason_required': 'Choose a cancellation reason',
  'console.cancel_note_required': "The 'other' reason needs a note",
  'console.cancel_note_placeholder': 'No names or phone numbers',
  'console.assign_error_cancel_reason_required':
    'A cancellation needs a reason',
  'console.assign_error_cancel_reason_not_allowed':
    'This reason cannot be used',
} as const satisfies Record<keyof typeof lvReasons, string>;
