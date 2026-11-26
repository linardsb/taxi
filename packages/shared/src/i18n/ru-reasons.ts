import type { lvReasons } from './lv-reasons';

/** Russian reason labels and console cancel picker strings (#316) — see `lv-reasons.ts`. */
export const ruReasons = {
  'reason.rider_changed_plans': 'Изменились планы',
  'reason.rider_wait_too_long': 'Слишком долго ждать',
  'reason.rider_booked_by_mistake': 'Заказано по ошибке',
  'reason.rider_other': 'Другая причина',
  'reason.driver_rider_no_show': 'Пассажир не пришёл',
  'reason.driver_vehicle_problem': 'Проблема с автомобилем',
  'reason.driver_safety_concern': 'Соображения безопасности',
  'reason.driver_other': 'Другая причина',
  'reason.dispatcher_rider_request': 'Просьба пассажира',
  'reason.dispatcher_duplicate_booking': 'Повторный заказ',
  'reason.dispatcher_no_driver_available': 'Нет свободного водителя',
  'reason.dispatcher_rider_no_show': 'Пассажир не пришёл',
  'reason.dispatcher_other': 'Другая причина',
  'reason.system_no_driver_found': 'Водитель не найден',
  'reason.decline_too_far': 'Слишком далеко',
  'reason.decline_unwanted_destination': 'Неудобный пункт назначения',
  'reason.decline_vehicle_unsuitable': 'Автомобиль не подходит',
  'reason.decline_on_break': 'У меня перерыв',
  'reason.decline_other': 'Другая причина',
  'console.cancel_reason_code': 'Причина',
  'console.cancel_reason_placeholder': 'Выберите причину',
  'console.cancel_reason_required': 'Выберите причину отмены',
  'console.cancel_note_required': "Для причины 'другая' нужно примечание",
  'console.cancel_note_placeholder': 'Без имён и номеров телефонов',
  'console.assign_error_cancel_reason_required': 'Для отмены нужна причина',
  'console.assign_error_cancel_reason_not_allowed':
    'Эту причину нельзя использовать',
} as const satisfies Record<keyof typeof lvReasons, string>;
