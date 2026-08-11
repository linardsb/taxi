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
  'page.retry': 'Mēģināt vēlreiz',
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
    'page.retry': 'Попробовать ещё раз',
  },
  en: {
    'sms.booking_confirmed': 'Your taxi is booked.',
    'sms.booking_confirmed_phone': 'Your taxi is booked. Track it: {link}',
    'sms.driver_assigned':
      'Your driver {driver}, {plate}, is ~{eta} min away. Track it: {link}',
    'sms.driver_arrived': 'Your taxi ({plate}) has arrived.',
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
    'page.retry': 'Try again',
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
