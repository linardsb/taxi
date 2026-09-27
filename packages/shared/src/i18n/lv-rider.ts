/**
 * The rider app's Latvian keys, split out of `lv.ts` when #269 pushed it past
 * the 500-line cap. Spread into `lv` last, so `MessageKey` is unchanged.
 */
export const lvRider = {
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
  'rider.book.pickup_pin': 'PIN kods iekāpšanai',
  'rider.book.pickup_pin_hint': 'Šoferis ievadīs jūsu PIN pirms brauciena.',
  'rider.book.name_row': 'Vārds vadītājam: {name}',
  'rider.book.name_row_empty': 'Vārds vadītājam: nav norādīts',
  'rider.book.name_row_hint': 'Atver vārda iestatījumu',
  'rider.book.confirm': 'Pasūtīt',
  'rider.book.confirming': 'Pasūta…',
  'rider.name.title': 'Kā vadītājs jūs uzrunās?',
  'rider.name.hint':
    'Vadītājs redz šo vārdu un pasaka to, kad piebrauc. Nav obligāti.',
  'rider.name.label': 'Vārds',
  'rider.name.save': 'Saglabāt',
  'rider.name.remove': 'Noņemt vārdu',
  'rider.name.saved': 'Vārds saglabāts',
  'rider.name.removed': 'Vārds noņemts',
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
  // «klāt», not «atbraucis»: the driver is AT the pickup point now, which is
  // the one thing this line has to mean. #135 stops the arrival SMS for app
  // bookings, so this string is the app rider's only arrival signal until
  // #17 ships push — a backgrounded rider still hears nothing.
  'rider.status.arrived': 'Auto ir klāt',
  'rider.status.arrived_pin': 'Auto ir klāt. PIN: {pin}',
  'rider.status.pin': 'Jūsu PIN kods: {pin}',
  'rider.status.cancelled': 'Brauciens ir atcelts',
  'rider.status.completed': 'Brauciens ir pabeigts',
  'rider.status.cancel': 'Atcelt braucienu',
  // The only control a FINISHED ride can offer. `/book/status` is reached by
  // `router.replace`, so there is no back entry to fall through to.
  'rider.status.book_again': 'Pasūtīt jaunu braucienu',
  'rider.status.reconnecting': 'Atjaunojam savienojumu…',
  // The Android notification channel's user-visible name (#17) — it appears
  // in system settings, where a rider can mute it. Named for what it carries,
  // not for the app, so muting it is an informed choice.
  'rider.push.channel_name': 'Paziņojumi par braucienu',
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
