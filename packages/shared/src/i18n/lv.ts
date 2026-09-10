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
  // Two different facts, deliberately two keys: an empty RANK is answered by
  // sending a car, a city with no configured zones by ringing whoever
  // configures them.
  'console.zone_empty': '(tukšs)',
  'console.zone_none_configured': 'Nevienai zonai nav konfigurācijas',
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
  // Zone grid + cascade strip (#19 Phase C).
  'console.zone_col_zone': 'Zona',
  'console.zone_col_mode': 'Režīms',
  'console.zone_col_queue': 'Rinda',
  'console.zone_queue_mode': 'Rindas kārtībā',
  'console.zone_queue_mode_off': 'Bez rindas',
  'console.zone_queue_position': 'Vieta rindā {position}',
  'console.zone_time': '{minutes} min zonā',
  'console.cascade_offered_to': 'Piedāvāts: {driver}',
  'console.cascade_next': 'Nākamais: {driver}',
  'console.cascade_attempts': 'Mēģinājumi: {count}',
  'console.cascade_unheld': 'Neviens netur',
  // "Why this driver" (#19 Phase C). NOT under `console.` — the driver app
  // (#15) renders these same keys, and the whole point of composing them once
  // in `explainAssignment` is that Dina and the driver read one sentence.
  // «zonā» is time in the QUEUE, not time since the driver's last job.
  'explain.geozone_queue':
    '{zone} rinda #{position} · zonā {minutes} min · {eta} min attālumā',
  'explain.auto_match': 'Tuvākais · {eta} min attālumā',
  'explain.dispatcher': 'Dispečera izvēle',
  'explain.eta_only': '{eta} min attālumā',
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
  // Driver app (#14). `push.*` are the server-sent nudge; everything under
  // `driver.*` is rendered by apps/driver. Error keys are the api's snake
  // codes verbatim, so a screen renders `driver.error.<code>` and falls back
  // to `driver.error.generic` for one it has never met.
  'push.offline_nudge_title': 'Sakta Cab',
  'push.offline_nudge_body':
    'Jūs esat bezsaistē. Atveriet lietotni, lai atkal saņemtu braucienus.',
  'driver.login.title': 'Šofera pieslēgšanās',
  'driver.login.phone_label': 'Tālruņa numurs',
  'driver.login.send_code': 'Sūtīt kodu',
  'driver.verify.title': 'Apstiprinājuma kods',
  'driver.verify.hint': 'Kods nosūtīts uz {phone}',
  'driver.verify.code_label': 'Kods',
  'driver.verify.resend': 'Sūtīt vēlreiz',
  'driver.verify.resend_in': 'Sūtīt vēlreiz pēc {seconds} s',
  'driver.error.invalid_or_expired_code': 'Nepareizs vai novecojis kods',
  'driver.error.resend_too_soon': 'Kods jau nosūtīts — pagaidiet brīdi',
  'driver.error.too_many_requests':
    'Pārāk daudz mēģinājumu — mēģiniet pēc stundas',
  'driver.error.sms_delivery_failed':
    'Neizdevās nosūtīt SMS. Mēģiniet vēlreiz.',
  'driver.error.session_expired':
    'Sesija ir beigusies. Pieslēdzieties vēlreiz.',
  'driver.error.vehicle_required': 'Lai ietu tiešsaistē, pievienojiet auto.',
  'driver.error.driver_on_ride': 'Jūs pašlaik izpildāt braucienu.',
  'driver.error.plate_taken': 'Šī numura zīme jau ir reģistrēta.',
  'driver.error.offline': 'Nav savienojuma ar serveri.',
  'driver.error.generic': 'Kaut kas nogāja greizi. Mēģiniet vēlreiz.',
  'driver.error.invalid_field': 'Pārbaudiet šo lauku',
  'driver.action.retry': 'Mēģināt vēlreiz',
  'driver.action.continue': 'Turpināt',
  'driver.action.save': 'Saglabāt',
  'driver.action.done': 'Gatavs',
  'driver.action.open_settings': 'Atvērt iestatījumus',
  'driver.action.skip': 'Izlaist',
  'driver.action.sign_out': 'Iziet',
  'driver.action.add_vehicle': 'Pievienot auto',
  'driver.profile.title': 'Jūsu profils',
  'driver.profile.languages': 'Valodas, kurās runājat',
  'driver.profile.female_driver': 'Esmu šofere (sieviete)',
  'driver.vehicle.title': 'Jūsu auto',
  'driver.vehicle.plate': 'Numura zīme',
  'driver.vehicle.make': 'Marka',
  'driver.vehicle.model': 'Modelis',
  'driver.vehicle.year': 'Izlaiduma gads',
  'driver.vehicle.seats': 'Pasažieru vietas',
  'driver.vehicle.child_seat': 'Ir bērnu sēdeklītis',
  'driver.documents.title': 'Dokumenti',
  'driver.documents.body':
    'Dokumentus pārbaudīsim klātienē pirms pirmās maiņas. Šobrīd nekas nav jāaugšupielādē.',
  'driver.home.go_online': 'Iet tiešsaistē',
  'driver.home.go_offline': 'Iet bezsaistē',
  'driver.home.status_online': 'Tiešsaistē',
  'driver.home.status_offline': 'Bezsaistē',
  // Label form («Braucieni: 7»), not «7 braucieni» — sidesteps LV plural
  // forms; logged in .claude/references/ui-decisions.md.
  'driver.home.today': 'Šodien: {amount} · Braucieni: {rides}',
  'driver.home.last_fix': 'Pēdējā pozīcija pirms {seconds} s',
  'driver.home.queued': 'Rindā: {count}',
  'driver.home.pill_live': 'Tiešraide',
  'driver.home.pill_reconnecting': 'Atjaunojas…',
  'driver.home.pill_offline': 'Nav savienojuma',
  'driver.home.marked_offline': 'Serveris jūs atzīmēja kā bezsaistē {time}',
  'driver.home.vehicle': 'Auto: {plate}',
  'driver.permission.foreground_denied':
    'Bez piekļuves atrašanās vietai nevar iet tiešsaistē.',
  'driver.permission.background_title': 'Atrašanās vieta fonā',
  'driver.permission.background_body':
    'Iestatījumos izvēlieties «Atļaut vienmēr», lai pozīcija tiktu sūtīta arī ar bloķētu ekrānu.',
  'driver.permission.battery_title': 'Akumulatora optimizācija',
  'driver.permission.battery_body':
    'Izslēdziet akumulatora optimizāciju šai lietotnei, lai pozīcija tiktu sūtīta arī fonā.',
  'driver.foreground_service.title': 'Sakta Cab — tiešsaistē',
  'driver.foreground_service.body': 'Pozīcija tiek sūtīta dispečeram.',
  // Each language's own name in that language — identical in all catalogs.
  'driver.lang.lv': 'Latviešu',
  'driver.lang.ru': 'Русский',
  'driver.lang.en': 'English',
  // Offer card, active ride, earnings (#15). `push.offer_*` is the api's
  // copy for the offer push; the `{amount}` there is the driver's NET.
  'push.offer_title': 'Jauns brauciens',
  'push.offer_body': 'Jūs saņemat {amount}. Atveriet, lai pieņemtu.',
  'driver.offer.title': 'Jauns brauciens',
  'driver.offer.fare': 'Cena {amount}',
  'driver.offer.you_keep': 'Jūs saņemat {amount} ({pct}%)',
  'driver.offer.pickup': 'Iekāpšana: {address}',
  'driver.offer.destination': 'Galamērķis: {address}',
  'driver.offer.eta': 'Līdz pasažierim ~{minutes} min · {km} km',
  'driver.offer.payment_cash': 'Skaidrā naudā',
  'driver.offer.payment_card': 'Ar karti',
  'driver.offer.countdown': 'Atlikušas {seconds} s',
  'driver.offer.accept': 'Pieņemt',
  'driver.offer.decline': 'Atteikt',
  'driver.offer.accepting': 'Pieņem…',
  'driver.offer.revoked_taken': 'Braucienu paņēma cits šoferis',
  'driver.offer.revoked_expired': 'Piedāvājuma laiks beidzās',
  'driver.offer.revoked_cancelled': 'Brauciens tika atcelts',
  'driver.offer.a11y_card':
    'Jauns brauciens. Cena {amount}, jūs saņemat {net}. Atlikušas {seconds} sekundes.',
  // Kept separate and appended LAST: the card is one accessible node, so the
  // instruction must not land before the fare, payment method and addresses.
  'driver.offer.a11y_accept': 'Pieskarieties, lai pieņemtu.',
  // «Rindā: 2. no 5», label form again — the LV ordinal takes a full stop.
  'driver.queue.position': 'Rindā: {position}. no {size} · {zone}',
  'driver.ride.title_accepted': 'Brauciens pieņemts',
  'driver.ride.title_arriving': 'Ceļā pie pasažiera',
  'driver.ride.title_arrived': 'Esat klāt',
  'driver.ride.title_in_progress': 'Brauciens notiek',
  'driver.ride.step_arriving': 'Braucu pie pasažiera',
  'driver.ride.step_arrived': 'Esmu klāt',
  'driver.ride.step_start': 'Sākt braucienu',
  'driver.ride.step_complete': 'Pabeigt braucienu',
  'driver.ride.navigate_maps': 'Atvērt Google Maps',
  'driver.ride.navigate_waze': 'Atvērt Waze',
  'driver.ride.payment': 'Apmaksa: {method}',
  'driver.ride.payment_changed':
    'Pasažieris nomainīja apmaksas veidu: {method}',
  'driver.ride.released': 'Dispečers nodeva braucienu citam šoferim',
  'driver.ride.cancelled': 'Brauciens atcelts. {reason}',
  'driver.ride.completed_title': 'Brauciens pabeigts',
  'driver.ride.reload': 'Ielādēt vēlreiz',
  'driver.earnings.title': 'Ieņēmumi',
  'driver.earnings.receipt_paid': 'Pasažieris samaksāja: {amount}',
  'driver.earnings.receipt_commission': 'Sakta ({pct}%): {amount}',
  'driver.earnings.receipt_net': 'Jūs saņemat: {amount}',
  'driver.earnings.none_yet': 'Šodien vēl nav pabeigtu braucienu',
  'driver.action.earnings': 'Ieņēmumi',
  'driver.error.offer_not_pending': 'Šis piedāvājums vairs nav aktīvs',
  'driver.error.ride_not_accepted': 'Brauciens vairs nav statusā «pieņemts»',
  'driver.error.ride_not_arriving': 'Brauciens vairs nav statusā «ceļā»',
  'driver.error.ride_not_arrived': 'Brauciens vairs nav statusā «klāt»',
  'driver.error.ride_not_in_progress': 'Brauciens vairs nenotiek',
  'driver.error.ride_transition_conflict':
    'Statuss tikko mainījās. Ielādējiet vēlreiz.',
  'driver.error.ride_not_yours': 'Šis brauciens nav piešķirts jums',
  'driver.error.ride_not_found': 'Brauciens nav atrasts',
  // `rider.*` is rendered by apps/rider (#16). Error keys are the api's snake
  // codes verbatim, so a screen renders `rider.error.<code>` and falls back to
  // `rider.error.generic` for one it has never met — the same contract the
  // `driver.error.*` block carries. The set is enumerated from api source, not
  // discovered at runtime: a missing key renders `generic`, which hides the
  // real cause from the one rider who most needs to hear it.
  //
  // Labels are AUDIO-LEAN by rule (`docs/research/rider-ux-evidence.md` §1.2):
  // no "button" suffix — the role says it — and no hint that repeats the label.
  // Blind riders consume audio at up to 3× speed and every extra word is a cost.
  'rider.loading': 'Ielādē…',
  'rider.login.title': 'Pieslēgšanās',
  'rider.login.phone_label': 'Tālruņa numurs',
  'rider.login.send_code': 'Sūtīt kodu',
  'rider.verify.title': 'Apstiprinājuma kods',
  'rider.verify.hint': 'Kods nosūtīts uz {phone}',
  'rider.verify.code_label': 'Kods',
  'rider.verify.resend': 'Sūtīt vēlreiz',
  'rider.verify.resend_in': 'Sūtīt vēlreiz pēc {seconds} s',
  'rider.book.title': 'Kurp dosimies?',
  'rider.book.pickup_label': 'Iekāpšanas vieta',
  'rider.book.dropoff_label': 'Galamērķis',
  'rider.book.use_current_location': 'Izmantot pašreizējo atrašanās vietu',
  'rider.book.where_to': 'Kurp?',
  // Distinct from `where_to` on purpose: with location refused BOTH rows fall
  // back to their empty copy, and a screen reader reading «Kurp?» twice, told
  // apart only by a trailing «Iekāpšanas vieta»/«Galamērķis», is two rows a
  // rider cannot tell apart.
  'rider.book.pickup_empty': 'Kur jūs uzņemt?',
  'rider.book.saved_header': 'Saglabātās adreses',
  'rider.book.save_address': 'Saglabāt šo adresi',
  'rider.book.save_prompt': 'Adreses nosaukums',
  'rider.book.retry_in': 'Mēģiniet vēlreiz pēc {seconds} s',
  'rider.book.retry': 'Mēģināt vēlreiz',
  'rider.book.searching': 'Meklē…',
  'rider.book.no_results': 'Nekas nav atrasts',
  // Location refused is an ORDINARY outcome (D7), not a failure — so it does
  // not get `rider.error.generic`, which tells the rider the app broke and
  // invites a retry that will fail identically.
  'rider.book.location_unavailable':
    'Atrašanās vieta nav pieejama — ievadiet adresi',
  'rider.book.min_chars': 'Ievadiet vismaz {count} rakstzīmes',
  'rider.book.quote_total': 'Cena {total}',
  'rider.book.quote_breakdown':
    'Pamatlikme {base}, attālums {distance}, laiks {time}',
  'rider.book.payment_label': 'Apmaksa',
  'rider.book.payment_cash': 'Skaidrā naudā',
  'rider.book.payment_card': 'Ar karti',
  'rider.book.confirm': 'Pasūtīt',
  'rider.book.confirming': 'Pasūta…',
  'rider.address.title_pickup': 'Iekāpšanas vieta',
  'rider.address.title_dropoff': 'Galamērķis',
  'rider.address.search_label': 'Adrese',
  // «Atrasti: 8», not «8 rezultāti»: LV, RU and EN all decline the noun by
  // count and the catalog has no plural machinery, so the number goes last and
  // agrees with nothing.
  'rider.address.results_count': 'Atrasti: {count}',
  'rider.status.title': 'Jūsu brauciens',
  'rider.status.searching': 'Meklējam auto…',
  // NEVER "no drivers found": the dispatcher's board owns that alert
  // (`dispatch:unclaimed`), and a rider told the search failed cancels a ride
  // that is still being worked. This says only that it is still running.
  'rider.status.still_searching': 'Vēl meklējam auto.',
  'rider.status.matched': 'Auto ir atrasts',
  'rider.status.cancelled': 'Brauciens ir atcelts',
  'rider.status.completed': 'Brauciens ir pabeigts',
  'rider.status.cancel': 'Atcelt braucienu',
  // The only control a FINISHED ride can offer. `/book/status` is reached by
  // `router.replace`, so there is no back entry to fall through to.
  'rider.status.book_again': 'Pasūtīt jaunu braucienu',
  'rider.status.reconnecting': 'Atjaunojam savienojumu…',
  'rider.a11y.quote_arrived': 'Cena {total}',
  'rider.a11y.quote_failed': 'Cenu neizdevās aprēķināt',
  'rider.a11y.ride_requested': 'Brauciens pieteikts',
  'rider.error.too_many_requests': 'Pārāk daudz mēģinājumu — pagaidiet brīdi',
  'rider.error.idempotent_request_in_progress':
    'Pieteikums vēl tiek apstrādāts…',
  'rider.error.scheduled_in_past': 'Norādītais laiks jau ir pagājis',
  'rider.error.multi_taxi_not_supported':
    'Vairāku auto pasūtījumi vēl nav pieejami',
  'rider.error.place_not_found':
    'Šī adrese vairs nav pieejama — meklējiet vēlreiz',
  'rider.error.invalid_or_expired_code': 'Nepareizs vai novecojis kods',
  'rider.error.resend_too_soon': 'Kods jau nosūtīts — pagaidiet brīdi',
  'rider.error.sms_delivery_failed':
    'Kodu neizdevās nosūtīt. Mēģiniet vēlreiz.',
  'rider.error.session_expired': 'Sesija ir beigusies. Pieslēdzieties vēlreiz.',
  'rider.error.invalid_field': 'Pārbaudiet šo lauku',
  'rider.error.offline': 'Nav savienojuma ar serveri.',
  'rider.error.generic': 'Kaut kas nogāja greizi. Mēģiniet vēlreiz.',
} as const;

/**
 * Every user-facing string key in the platform, derived from the LATVIAN
 * catalog above rather than declared by hand — a key with no Latvian copy is
 * not a key, because Latvian is the language the pilot ships in.
 */
export type MessageKey = keyof typeof lv;
