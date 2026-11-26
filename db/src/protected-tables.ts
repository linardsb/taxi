/**
 * K1 (#316): the tables 35.² (5) protects, with the triggers that protect
 * them (migration 0018). `db/tests/protected-tables.test.ts` is driven by
 * these lists and checks every named trigger exists and is enabled.
 *
 * Later tickets ADD their tables here as an AC of their own (#319, #327), and
 * add the same name to the `no-restricted-syntax` list in
 * `services/api/eslint.config.mjs`.
 */

/** Append-only: UPDATE (beyond guarded moves), DELETE and TRUNCATE raise. */
export const PROTECTED_TABLES = [
  {
    table: 'ride_events',
    triggers: ['ride_events_protect', 'ride_events_protect_truncate'],
  },
  {
    table: 'ride_offers',
    triggers: ['ride_offers_guard', 'ride_offers_protect_truncate'],
  },
] as const;

/** Mutable for lifecycle (AP1), but DELETE and TRUNCATE raise. */
export const DELETE_BLOCKED_TABLES = [
  { table: 'rides', triggers: ['rides_no_delete', 'rides_no_truncate'] },
  { table: 'drivers', triggers: ['drivers_no_delete', 'drivers_no_truncate'] },
  {
    table: 'vehicles',
    triggers: ['vehicles_no_delete', 'vehicles_no_truncate'],
  },
] as const;
