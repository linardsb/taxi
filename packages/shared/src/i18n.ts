import type { Language } from './enums';

/**
 * The LV/RU/EN message catalog (root rule: nothing user-facing is hardcoded).
 * First consumers: the ride-status SMS (#63) and the no-login tracking page.
 *
 * SMS bodies are deliberately terse — SMS are billed per 160-char segment
 * (budget guardrail), and GSM-7 doesn't cover Latvian diacritics, so long
 * copy gets expensive fast.
 *
 * `lv` is the reference dictionary: `MessageKey` derives from it, and the
 * `satisfies` clause forces `ru`/`en` to carry exactly the same keys.
 * Placeholder parity across languages is pinned by `tests/i18n.test.ts`.
 */
const lv = {
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
} as const;

export type MessageKey = keyof typeof lv;

export const MESSAGES = {
  lv,
  ru: {
    'sms.booking_confirmed': 'Ваше такси забронировано.',
    'sms.booking_confirmed_phone':
      'Ваше такси забронировано. Следите здесь: {link}',
    'sms.driver_assigned':
      'Ваш водитель {driver}, {plate}, будет через ~{eta} мин. Следите здесь: {link}',
    'sms.driver_arrived': 'Ваше такси ({plate}) на месте.',
    'sms.otp_code': 'Код Sakta Cab: {code}',
    'page.title': 'Ваша поездка',
    'page.searching': 'Ищем вам водителя…',
    'page.assigned': 'Водитель найден',
    'page.arriving': 'Водитель в пути',
    'page.arrived': 'Ваше такси на месте',
    'page.in_progress': 'Поездка началась',
    'page.driver': 'Водитель',
    'page.plate': 'Гос. номер',
    'page.eta_minutes': 'Прибудет через ~{eta} мин',
    'page.call_dispatch': 'Позвонить диспетчеру',
    'page.completed': 'Поездка завершена.',
    'page.cancelled': 'Поездка отменена.',
    'page.expired': 'Эта ссылка больше не активна.',
    'page.not_found': 'Поездка не найдена.',
    'page.position_updated': 'Местоположение обновлено {time}',
    'page.connection_lost':
      'Связь потеряна. Показаны последние данные ({time}).',
    'page.too_many_viewers':
      'За этой поездкой сейчас следит слишком много людей. Попробуйте через минуту.',
    'page.retry': 'Попробовать ещё раз',
    'console.title': 'Sakta Cab — консоль диспетчера',
    'console.loading': 'Загрузка…',
    'console.live': 'В сети',
    'console.reconnecting': 'Переподключение…',
    'console.offline': 'Нет связи',
    'console.queue_requested': 'Ожидают водителя',
    'console.queue_offered': 'Предложены',
    'console.queue_active': 'Активные поездки',
    'console.empty_queue': 'Поездок нет',
    'console.zones': 'Зоны',
    'console.map': 'Карта',
    'console.zone_empty': '(пусто)',
    'console.zone_none': 'Вне зон',
    'console.map_alt':
      'Карта с местоположением водителей. Список доступен в виде зон.',
    'console.status_requested': 'Ищем водителя',
    'console.status_offered': 'Предложена водителю',
    'console.status_queued': 'В очереди',
    'console.status_accepted': 'Водитель принял',
    'console.status_arriving': 'Водитель в пути',
    'console.status_arrived': 'Водитель на месте',
    'console.status_in_progress': 'Поездка началась',
    'console.driver_status_online': 'Онлайн',
    'console.driver_status_on_ride': 'Выполняет поездку',
    'console.driver_status_offline': 'Не в сети',
    'console.alert_unclaimed': 'Непринятый заказ',
    'console.alert_sms_failed': 'Не удалось отправить {kind}',
    'console.sms_kind_booking_confirmed': 'SMS с подтверждением',
    'console.sms_kind_driver_assigned': 'SMS о назначении водителя',
    'console.sms_kind_driver_arrived': 'SMS о прибытии',
    'console.alert_offline': 'Связь с сервером потеряна',
    'console.alert_ack': 'Подтвердить',
    'console.alerts_muted': 'Звук выключен',
    'console.alerts_unmuted': 'Звук включён',
    'console.stale_banner':
      'Нет связи. Показаны последние известные данные ({time}).',
    'console.stale_banner_silent':
      'Нет новых данных. Показаны последние известные данные ({time}).',
    'console.retry': 'Повторить попытку',
    'console.login_title': 'Вход для диспетчера',
    'console.phone': 'Номер телефона',
    'console.phone_placeholder': '+371…',
    'console.send_code': 'Отправить код',
    'console.code': 'Код подтверждения',
    'console.sign_in': 'Войти',
    'console.no_access': 'У этого аккаунта нет доступа к консоли',
    'console.wrong_code': 'Неверный или устаревший код',
    'console.request_failed': 'Не удалось отправить код. Попробуйте ещё раз.',
    'console.admin_placeholder': 'Раздел администрирования появится позже',
    'console.assign': 'Назначить',
    'console.reassign': 'Переназначить',
    'console.assign_ride_at': 'Назначить поездку — {address}',
    'console.reassign_ride_at': 'Переназначить поездку — {address}',
    'console.cancel_ride_at': 'Отменить поездку — {address}',
    'console.assign_title': 'Назначить водителя',
    'console.reassign_title': 'Переназначить поездку',
    'console.assign_pick_driver': 'Выберите водителя',
    'console.assign_filter': 'Поиск по имени, номеру или телефону',
    'console.assign_no_drivers': 'Водителей нет',
    'console.assign_reason': 'Причина (необязательно)',
    'console.assign_confirm': 'Подтвердить',
    'console.assign_back': 'Назад',
    'console.assign_cancel': 'Отмена',
    'console.assign_submitting': 'Назначаем…',
    'console.assign_on_ride': 'На заказе',
    'console.assign_offline_warning': '{name} не в сети — всё равно назначить?',
    'console.assign_on_ride_warning':
      '{name} уже на заказе — всё равно назначить?',
    'console.assign_offline_disabled':
      'Нет связи — назначение недоступно, пока соединение не восстановлено',
    'console.assign_failed': 'Не удалось назначить. Попробуйте ещё раз.',
    'console.assign_error_ride_not_found': 'Поездки больше не существует',
    'console.assign_error_driver_not_found': 'Водитель не найден',
    'console.assign_error_ride_not_assignable':
      'Поездка уже назначена или отменена — список обновится сам',
    'console.assign_error_ride_already_assigned':
      'Поездка уже назначена другому водителю',
    'console.assign_error_ride_not_reassignable':
      'Эту поездку уже нельзя переназначить — водитель на месте или в пути',
    'console.assign_error_ride_not_cancellable':
      'Эту поездку уже нельзя отменить — она завершена или отменена',
    'console.assign_error_ride_moved_on':
      'Статус поездки изменился — список обновится сам',
    'console.cancel_ride': 'Отменить поездку',
    'console.cancel_title': 'Отменить поездку',
    'console.cancel_reason': 'Причина отмены (необязательно)',
    'console.cancel_confirm': 'Отменить поездку',
    'console.cancel_keep': 'Нет, оставить',
    'console.cancel_failed': 'Не удалось отменить. Попробуйте ещё раз.',
  },
  en: {
    'sms.booking_confirmed': 'Your taxi is booked.',
    'sms.booking_confirmed_phone': 'Your taxi is booked. Track it: {link}',
    'sms.driver_assigned':
      'Your driver {driver}, {plate}, is ~{eta} min away. Track it: {link}',
    'sms.driver_arrived': 'Your taxi ({plate}) has arrived.',
    'sms.otp_code': 'Sakta Cab code: {code}',
    'page.title': 'Your ride',
    'page.searching': 'Looking for your driver…',
    'page.assigned': 'Driver assigned',
    'page.arriving': 'Driver is on the way',
    'page.arrived': 'Your taxi has arrived',
    'page.in_progress': 'Ride in progress',
    'page.driver': 'Driver',
    'page.plate': 'Plate',
    'page.eta_minutes': 'Arriving in ~{eta} min',
    'page.call_dispatch': 'Call dispatch',
    'page.completed': 'Ride completed.',
    'page.cancelled': 'Ride cancelled.',
    'page.expired': 'This link is no longer active.',
    'page.not_found': 'Ride not found.',
    'page.position_updated': 'Location updated {time}',
    'page.connection_lost':
      'Connection lost. Showing last known data ({time}).',
    'page.too_many_viewers':
      'Too many people are watching this ride right now. Try again in a moment.',
    'page.retry': 'Try again',
    'console.title': 'Sakta Cab — dispatch console',
    'console.loading': 'Loading…',
    'console.live': 'Live',
    'console.reconnecting': 'Reconnecting…',
    'console.offline': 'Offline',
    'console.queue_requested': 'Waiting for driver',
    'console.queue_offered': 'Offered',
    'console.queue_active': 'Active rides',
    'console.empty_queue': 'No rides',
    'console.zones': 'Zones',
    'console.map': 'Map',
    'console.zone_empty': '(empty)',
    'console.zone_none': 'Outside zones',
    'console.map_alt':
      'Map of driver positions. The list is available in the zones view.',
    'console.status_requested': 'Looking for a driver',
    'console.status_offered': 'Offered to a driver',
    'console.status_queued': 'Queued',
    'console.status_accepted': 'Driver accepted',
    'console.status_arriving': 'Driver on the way',
    'console.status_arrived': 'Driver arrived',
    'console.status_in_progress': 'Ride started',
    'console.driver_status_online': 'Online',
    'console.driver_status_on_ride': 'On a ride',
    'console.driver_status_offline': 'Not online',
    'console.alert_unclaimed': 'Unclaimed order',
    'console.alert_sms_failed': 'Failed to send {kind}',
    'console.sms_kind_booking_confirmed': 'the confirmation SMS',
    'console.sms_kind_driver_assigned': 'the driver-assigned SMS',
    'console.sms_kind_driver_arrived': 'the arrival SMS',
    'console.alert_offline': 'Connection to the server lost',
    'console.alert_ack': 'Acknowledge',
    'console.alerts_muted': 'Sound off',
    'console.alerts_unmuted': 'Sound on',
    'console.stale_banner': 'Offline. Showing last known data ({time}).',
    'console.stale_banner_silent':
      'No new data. Showing last known data ({time}).',
    'console.retry': 'Retry',
    'console.login_title': 'Dispatcher sign-in',
    'console.phone': 'Phone number',
    'console.phone_placeholder': '+371…',
    'console.send_code': 'Send code',
    'console.code': 'Verification code',
    'console.sign_in': 'Sign in',
    'console.no_access': 'This account has no console access',
    'console.wrong_code': 'Wrong or expired code',
    'console.request_failed': 'Could not send the code. Try again.',
    'console.admin_placeholder': 'The admin area arrives later',
    'console.assign': 'Assign',
    'console.reassign': 'Reassign',
    'console.assign_ride_at': 'Assign the ride at {address}',
    'console.reassign_ride_at': 'Reassign the ride at {address}',
    'console.cancel_ride_at': 'Cancel the ride at {address}',
    'console.assign_title': 'Assign a driver',
    'console.reassign_title': 'Reassign the ride',
    'console.assign_pick_driver': 'Pick a driver',
    'console.assign_filter': 'Search by name, plate or phone',
    'console.assign_no_drivers': 'No drivers',
    'console.assign_reason': 'Reason (optional)',
    'console.assign_confirm': 'Confirm',
    'console.assign_back': 'Back',
    'console.assign_cancel': 'Cancel',
    'console.assign_submitting': 'Assigning…',
    'console.assign_on_ride': 'On a ride',
    'console.assign_offline_warning': '{name} is offline — assign anyway?',
    'console.assign_on_ride_warning':
      '{name} is already on a ride — assign anyway?',
    'console.assign_offline_disabled':
      'Offline — assigning is unavailable until the connection is back',
    'console.assign_failed': 'Could not assign. Try again.',
    'console.assign_error_ride_not_found': 'That ride no longer exists',
    'console.assign_error_driver_not_found': 'Driver not found',
    'console.assign_error_ride_not_assignable':
      'The ride is already assigned or cancelled — the board will catch up',
    'console.assign_error_ride_already_assigned':
      'The ride is already assigned to another driver',
    'console.assign_error_ride_not_reassignable':
      'This ride can no longer be reassigned — the driver has arrived or is driving',
    'console.assign_error_ride_not_cancellable':
      'This ride can no longer be cancelled — it has already ended or been cancelled',
    'console.assign_error_ride_moved_on':
      'The ride changed status — the board will catch up',
    'console.cancel_ride': 'Cancel ride',
    'console.cancel_title': 'Cancel ride',
    'console.cancel_reason': 'Cancellation reason (optional)',
    'console.cancel_confirm': 'Cancel the ride',
    'console.cancel_keep': 'No, keep it',
    'console.cancel_failed': 'Could not cancel. Try again.',
  },
} as const satisfies Record<Language, Record<MessageKey, string>>;

/**
 * `{placeholder}` interpolation. Unknown placeholders are left verbatim rather
 * than swallowed — a visible `{eta}` in a message is a bug you can see and
 * report; an empty gap is one you can't.
 */
export function formatMessage(
  lang: Language,
  key: MessageKey,
  params: Readonly<Record<string, string | number>> = {},
): string {
  return MESSAGES[lang][key].replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
