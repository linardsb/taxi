/**
 * The LATVIAN catalog — and the REFERENCE dictionary for the other two.
 *
 * `MessageKey` derives from this object, and `i18n.ts`'s `satisfies` clause
 * forces `ru`/`en` to carry exactly the same keys, so a key added here without
 * a translation fails typecheck rather than rendering blank to a rider.
 *
 * SMS bodies are deliberately terse: SMS bill per 160-char segment (budget
 * guardrail) and GSM-7 has no Latvian diacritics, so long copy gets expensive.
 */
export const lv = {
  'sms.booking_confirmed': 'Jūsu taksometrs ir rezervēts.',
  'sms.booking_confirmed_phone':
    'Jūsu taksometrs ir rezervēts. Sekojiet līdzi: {link}',
  'sms.driver_assigned':
    'Jūsu šoferis {driver}, {plate}, būs pēc ~{eta} min. Sekojiet līdzi: {link}',
  'sms.driver_arrived': 'Jūsu taksometrs ({plate}) ir klāt.',
  // Deliberately diacritic-free: GSM-7 keeps the OTP at 1 billed segment.
  'sms.otp_code': 'Sakta Cab kods: {code}',
  'page.title': 'Jūsu brauciens',
  'page.searching': 'Meklējam jums šoferi…',
  'page.assigned': 'Šoferis ir atrasts',
  'page.arriving': 'Šoferis ir ceļā',
  'page.arrived': 'Jūsu taksometrs ir klāt',
  'page.in_progress': 'Brauciens ir sācies',
  'page.driver': 'Šoferis',
  'page.plate': 'Numura zīme',
  'page.eta_minutes': 'Ieradīsies pēc ~{eta} min',
  'page.call_dispatch': 'Zvanīt dispečeram',
  'page.completed': 'Brauciens ir pabeigts.',
  'page.cancelled': 'Brauciens ir atcelts.',
  'page.expired': 'Šī saite vairs nav aktīva.',
  'page.not_found': 'Brauciens nav atrasts.',
  'page.position_updated': 'Atrašanās vieta atjaunota {time}',
  'page.connection_lost':
    'Savienojums zudis. Rādām pēdējos zināmos datus ({time}).',
  'page.too_many_viewers':
    'Šo braucienu pašlaik seko pārāk daudz cilvēku. Pamēģiniet pēc brīža.',
  'page.retry': 'Mēģināt vēlreiz',
  // Dispatch console (#18). `console.live/reconnecting/offline` are the
  // truthful connection pill — derived from frame receipt, not socket flags.
  'console.title': 'Sakta Cab — dispečera konsole',
  'console.loading': 'Ielādē…',
  'console.live': 'Tiešraide',
  'console.reconnecting': 'Atjaunojas…',
  'console.offline': 'Bezsaistē',
  'console.queue_requested': 'Gaida šoferi',
  'console.queue_offered': 'Piedāvāti',
  'console.queue_active': 'Aktīvie braucieni',
  'console.empty_queue': 'Nav braucienu',
  'console.zones': 'Zonas',
  'console.map': 'Karte',
  'console.zone_empty': '(tukšs)',
  'console.zone_none': 'Ārpus zonām',
  'console.map_alt':
    'Karte ar šoferu atrašanās vietām. Saraksts pieejams zonu skatā.',
  'console.status_requested': 'Meklē šoferi',
  'console.status_offered': 'Piedāvāts šoferim',
  'console.status_queued': 'Rindā',
  'console.status_accepted': 'Šoferis pieņēmis',
  'console.status_arriving': 'Šoferis ceļā',
  'console.status_arrived': 'Šoferis klāt',
  'console.status_in_progress': 'Brauciens sācies',
  'console.driver_status_online': 'Tiešsaistē',
  'console.driver_status_on_ride': 'Izpilda braucienu',
  'console.driver_status_offline': 'Nav tiešsaistē',
  'console.alert_unclaimed': 'Nepieņemts pasūtījums',
  'console.alert_sms_failed': 'Neizdevās nosūtīt {kind}',
  'console.sms_kind_booking_confirmed': 'apstiprinājuma SMS',
  'console.sms_kind_driver_assigned': 'šofera piešķiršanas SMS',
  'console.sms_kind_driver_arrived': 'ierašanās SMS',
  'console.alert_offline': 'Savienojums ar serveri zudis',
  'console.alert_ack': 'Apstiprināt',
  'console.alerts_muted': 'Skaņa izslēgta',
  'console.alerts_unmuted': 'Skaņa ieslēgta',
  'console.stale_banner': 'Bezsaistē. Rādām pēdējos zināmos datus ({time}).',
  // Connected but no fresh frame — «Bezsaistē» would be a lie here.
  'console.stale_banner_silent':
    'Nav jaunu datu. Rādām pēdējos zināmos datus ({time}).',
  'console.retry': 'Mēģināt vēlreiz',
  'console.login_title': 'Dispečera pieslēgšanās',
  'console.phone': 'Tālruņa numurs',
  'console.phone_placeholder': '+371…',
  'console.send_code': 'Sūtīt kodu',
  'console.code': 'Apstiprinājuma kods',
  'console.sign_in': 'Pieslēgties',
  'console.no_access': 'Šim kontam nav piekļuves konsolei',
  'console.wrong_code': 'Nepareizs vai novecojis kods',
  'console.request_failed': 'Neizdevās nosūtīt kodu. Mēģiniet vēlreiz.',
  'console.admin_placeholder': 'Administrēšanas sadaļa tiks pievienota vēlāk',
  // Force-assign / override (#19, S9-2). Two verbs: «Piešķirt» puts a car on a
  // ride with none, «Piešķirt atkārtoti» swaps the car already on it.
  'console.assign': 'Piešķirt',
  'console.reassign': 'Piešķirt atkārtoti',
  // The row buttons' ACCESSIBLE names. The visible label stays short; these
  // carry the pickup so twelve rows do not announce as twelve identical
  // buttons while tabbing (#120 review M6).
  'console.assign_ride_at': 'Piešķirt braucienu — {address}',
  'console.reassign_ride_at': 'Piešķirt atkārtoti braucienu — {address}',
  'console.cancel_ride_at': 'Atcelt braucienu — {address}',
  'console.assign_title': 'Piešķirt šoferi',
  'console.reassign_title': 'Piešķirt braucienu atkārtoti',
  'console.assign_pick_driver': 'Izvēlieties šoferi',
  'console.assign_filter': 'Meklēt pēc vārda, numura zīmes vai tālruņa',
  'console.assign_no_drivers': 'Nav neviena šofera',
  'console.assign_reason': 'Iemesls (nav obligāts)',
  'console.assign_confirm': 'Apstiprināt',
  'console.assign_back': 'Atpakaļ',
  'console.assign_cancel': 'Atcelt',
  'console.assign_submitting': 'Piešķir…',
  'console.assign_on_ride': 'Izpilda braucienu',
  // The override is deliberately NOT filtered through the eligibility rules
  // (S9-2) — so an ineligible driver is a WARNING plus a second confirm, never
  // a block. Dina has the driver on the phone; his app crashed.
  'console.assign_offline_warning':
    '{name} nav tiešsaistē — piešķirt tik un tā?',
  'console.assign_on_ride_warning':
    '{name} jau izpilda braucienu — piešķirt tik un tā?',
  'console.assign_offline_disabled':
    'Bezsaistē — piešķiršana nav iespējama, kamēr nav savienojuma',
  // The API's error codes, in Dina's words. `assign_failed` is the fallback:
  // an unmapped code renders this, never the raw code.
  'console.assign_failed': 'Neizdevās piešķirt. Mēģiniet vēlreiz.',
  'console.assign_error_ride_not_found': 'Brauciens vairs neeksistē',
  'console.assign_error_driver_not_found': 'Šoferis nav atrasts',
  'console.assign_error_ride_not_assignable':
    'Brauciens jau ir piešķirts vai atcelts — saraksts atjaunosies pats',
  'console.assign_error_ride_already_assigned':
    'Brauciens jau ir piešķirts citam šoferim',
  'console.assign_error_ride_not_reassignable':
    'Šo braucienu vairs nevar piešķirt atkārtoti — šoferis jau ir klāt vai brauc',
  'console.assign_error_ride_not_cancellable':
    'Šo braucienu vairs nevar atcelt — tas jau ir beidzies vai atcelts',
  'console.assign_error_ride_moved_on':
    'Brauciena statuss mainījās — saraksts atjaunosies pats',
  'console.cancel_ride': 'Atcelt braucienu',
  'console.cancel_title': 'Atcelt braucienu',
  'console.cancel_reason': 'Atcelšanas iemesls (nav obligāts)',
  'console.cancel_confirm': 'Atcelt braucienu',
  'console.cancel_keep': 'Nē, atstāt',
  'console.cancel_failed': 'Neizdevās atcelt. Mēģiniet vēlreiz.',
  // Phone orders (#19). The keyboard-first booking form: Dina takes the order
  // while the caller is still speaking, so every label here is read at a
  // glance, not studied.
  'console.new_order': 'Jauns pasūtījums',
  'console.new_order_hotkey': 'Jauns pasūtījums (⌥N)',
  'console.new_order_title': 'Jauns pasūtījums pa tālruni',
  'console.caller_phone': 'Zvanītāja tālrunis',
  'console.caller_name': 'Vārds (nav obligāts)',
  'console.caller_lookup_none': 'Jauns zvanītājs',
  'console.caller_lookup_failed': 'Neizdevās atrast zvanītāju',
  'console.caller_searching': 'Meklē…',
  'console.recent_jobs': 'Pēdējie braucieni',
  'console.recent_job_reuse': 'Izmantot: {from} → {to}',
  'console.venues': 'Iestādes',
  'console.venues_empty': 'Nav saglabātu iestāžu',
  'console.venue_pick': 'Izvēlēties {name}',
  'console.pickup': 'Izbraukšanas vieta',
  'console.destination': 'Galamērķis',
  'console.note': 'Piezīme šoferim (nav obligāta)',
  'console.payment_method': 'Apmaksa',
  'console.payment_cash': 'Skaidrā naudā',
  'console.payment_card': 'Ar karti',
  'console.book': 'Pasūtīt',
  'console.booking_submitting': 'Pasūta…',
  'console.booking_created': 'Pasūtījums izveidots',
  'console.booking_close': 'Aizvērt',
  // The address combobox. `address_offline` is the offline rule in words: the
  // typed text is KEPT, the order simply cannot be sent yet.
  'console.address_search_hint': 'Ierakstiet ielu un mājas numuru',
  'console.address_searching': 'Meklē adreses…',
  'console.address_no_results': 'Nav atrastu adrešu',
  'console.address_failed': 'Adrešu meklēšana nedarbojas',
  'console.address_offline':
    'Bezsaistē — adresi saglabāsim, bet pasūtīt varēs pēc savienojuma',
  'console.address_unresolved': 'Izvēlieties adresi no saraksta',
  'console.address_expired': 'Adrese ir novecojusi — izvēlieties to no jauna',
  // Booking errors, in Dina's words. `booking_failed` is the fallback: an
  // unmapped code renders this, never the raw code.
  'console.booking_failed': 'Neizdevās pasūtīt. Mēģiniet vēlreiz.',
  'console.booking_offline_disabled':
    'Bezsaistē — pasūtīt nevar, kamēr nav savienojuma',
  'console.booking_error_phone_belongs_to_staff':
    'Šis numurs pieder šoferim vai dispečeram',
  'console.booking_error_too_many_requests':
    'Pārāk daudz pasūtījumu pēc kārtas — mēģiniet pēc {retry} s',
} as const;

/**
 * Every user-facing string key in the platform, derived from the LATVIAN
 * catalog above rather than declared by hand — a key with no Latvian copy is
 * not a key, because Latvian is the language the pilot ships in.
 */
export type MessageKey = keyof typeof lv;
