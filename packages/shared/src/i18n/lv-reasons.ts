/**
 * Cancel and decline reason labels (#316) plus the console cancel picker's
 * strings, split out of `lv.ts` like `lvAdmin`. Spread into `lv`, so
 * `MessageKey` covers them. Keys are `reason.<code>` — `REASON_LABEL_KEYS` in
 * `reasons.ts` pins one per code. This file must not import `reasons.ts`
 * (`reasons.ts` imports `MessageKey` from `lv.ts`).
 */
export const lvReasons = {
  'reason.rider_changed_plans': 'Mainījās plāni',
  'reason.rider_wait_too_long': 'Pārāk ilgi jāgaida',
  'reason.rider_booked_by_mistake': 'Pasūtīts kļūdas pēc',
  'reason.rider_other': 'Cits iemesls',
  'reason.driver_rider_no_show': 'Pasažieris neieradās',
  'reason.driver_vehicle_problem': 'Problēma ar auto',
  'reason.driver_safety_concern': 'Drošības apsvērumi',
  'reason.driver_other': 'Cits iemesls',
  'reason.dispatcher_rider_request': 'Pasažiera lūgums',
  'reason.dispatcher_duplicate_booking': 'Dubults pasūtījums',
  'reason.dispatcher_no_driver_available': 'Nav pieejama šofera',
  'reason.dispatcher_rider_no_show': 'Pasažieris neieradās',
  'reason.dispatcher_other': 'Cits iemesls',
  'reason.system_no_driver_found': 'Šoferis netika atrasts',
  'reason.decline_too_far': 'Pārāk tālu',
  'reason.decline_unwanted_destination': 'Neizdevīgs galamērķis',
  'reason.decline_vehicle_unsuitable': 'Auto nav piemērots',
  'reason.decline_on_break': 'Esmu pārtraukumā',
  'reason.decline_other': 'Cits iemesls',
  'console.cancel_reason_code': 'Iemesls',
  'console.cancel_reason_placeholder': 'Izvēlieties iemeslu',
  'console.cancel_reason_required': 'Izvēlieties atcelšanas iemeslu',
  'console.cancel_note_required': "Iemeslam 'cits' vajag piezīmi",
  'console.cancel_note_placeholder': 'Bez vārdiem vai tālruņa numuriem',
  'console.assign_error_cancel_reason_required': 'Atcelšanai vajag iemeslu',
  'console.assign_error_cancel_reason_not_allowed': 'Šo iemeslu nevar izmantot',
} as const;
