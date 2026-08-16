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
