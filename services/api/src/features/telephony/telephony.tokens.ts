/**
 * The bound `TelephonyProvider` (@taxi/shared). One token, one binding — there
 * is no second facade to decorate here the way `MAPS_PROVIDER` has, because a
 * dial costs the gateway's money, not ours, and nothing is cacheable.
 */
export const TELEPHONY_PROVIDER = 'TELEPHONY_PROVIDER';
