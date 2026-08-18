import {
  addressPointSchema,
  phoneSchema,
  type AddressPoint,
  type BookablePaymentMethod,
  type MessageKey,
} from '@taxi/shared';
import { z } from 'zod';

/**
 * The booking form's pure state module — the draft shape, its transitions and
 * its persistence, with no React, no fetch and no clock of its own (callers
 * pass time, like `board-state.ts`).
 *
 * The ledger row this file exists for is "Booking form data lost on
 * disconnect/refresh: 0". Everything here is in service of that number.
 */

/**
 * How long a resolved coordinate may sit in a restored draft.
 *
 * Mirrors the api's `MAPS_PLACE_CACHE_TTL_SECONDS` default (30 days) — the
 * console cannot read the server's env, so this is a deliberate duplicate of a
 * number rather than a derived one. It bounds the same thing from the client
 * side: a draft restored after a long absence must not book a coordinate whose
 * Places provenance has expired. Move the env knob and move this with it.
 */
export const DRAFT_POINT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * One address field's state.
 *
 * `text` and `point` are SEPARATE and both persist. What the dispatcher typed
 * is never thrown away because the resolution failed or the console went
 * offline — dropping it is the exact "console traps data" failure the offline
 * rule exists to prevent. `point === null` is what makes the draft unbookable,
 * and the form says so in words.
 */
export interface DraftAddress {
  text: string;
  point: AddressPoint | null;
  placeId: string | null;
  /** When `point` was resolved — the age `DRAFT_POINT_MAX_AGE_MS` bounds. */
  resolvedAtMs: number | null;
}

export interface BookingDraft {
  /**
   * Minted ONCE per draft, not per submit attempt. That is the whole
   * idempotency property: a dispatcher who hits Book, sees a timeout and hits
   * Book again sends the same key, and the api replays the first ride instead
   * of dispatching a second car.
   */
  idempotencyKey: string;
  phone: string;
  callerName: string;
  pickup: DraftAddress;
  destination: DraftAddress;
  note: string;
  paymentMethod: BookablePaymentMethod;
  /** Set when a venue or a past job filled the pickup — audit for the form. */
  prefilledFrom: 'venue' | 'recent' | null;
}

const emptyAddress = (): DraftAddress => ({
  text: '',
  point: null,
  placeId: null,
  resolvedAtMs: null,
});

export function emptyDraft(idempotencyKey: string): BookingDraft {
  return {
    idempotencyKey,
    phone: '',
    callerName: '',
    pickup: emptyAddress(),
    destination: emptyAddress(),
    note: '',
    // Cash by default: the phone channel's caller has no app and therefore no
    // enrolled card, so `card` on a phone order is unsettleable at the kerb.
    paymentMethod: 'cash',
    prefilledFrom: null,
  };
}

export type AddressField = 'pickup' | 'destination';

/** Typing into an address field INVALIDATES its resolution — the text and the
 *  coordinate must never describe different places. */
export function setAddressText(
  draft: BookingDraft,
  field: AddressField,
  text: string,
): BookingDraft {
  return {
    ...draft,
    [field]: { text, point: null, placeId: null, resolvedAtMs: null },
  };
}

export function setAddressPoint(
  draft: BookingDraft,
  field: AddressField,
  point: AddressPoint,
  placeId: string | null,
  nowMs: number,
): BookingDraft {
  return {
    ...draft,
    [field]: { text: point.address, point, placeId, resolvedAtMs: nowMs },
  };
}

/**
 * A resolved point older than the window is dropped back to its TEXT, not
 * cleared: the dispatcher still sees the address they typed and one keystroke
 * re-resolves it. Clearing the text would be the data-loss failure again, in a
 * slower form.
 */
export function expireStalePoints(
  draft: BookingDraft,
  nowMs: number,
): BookingDraft {
  const expire = (address: DraftAddress): DraftAddress =>
    address.resolvedAtMs !== null &&
    nowMs - address.resolvedAtMs > DRAFT_POINT_MAX_AGE_MS
      ? { ...address, point: null, placeId: null, resolvedAtMs: null }
      : address;
  return {
    ...draft,
    pickup: expire(draft.pickup),
    destination: expire(draft.destination),
  };
}

/**
 * What Dina typed → E.164, for the two places that need it: the caller lookup
 * and the booking body.
 *
 * The TYPED TEXT is never rewritten — normalizing the field under the cursor
 * moves it mid-number, and this module's whole job is not losing what was
 * entered. Only the value read out of the draft is normalized.
 *
 * Deliberately here and NOT a `.transform()` on shared `phoneSchema`: that
 * schema is `otpRequestSchema`'s too, and widening what the auth path accepts
 * is a change to who can request an OTP, not a console convenience.
 *
 * Three spellings a dispatcher actually types, and nothing more:
 * `+371 29 999 000` (grouped), `0037129999000` (international prefix) and
 * `29999000` (a bare Latvian mobile — 8 digits from 2, per `phoneSchema`'s own
 * "+371 2xxxxxxx"). Anything else is returned compacted and left to fail
 * validation, because guessing a country for it would file the caller under a
 * number that is not theirs.
 */
export function normalizePhone(typed: string): string {
  const compact = typed.replace(/[\s()\-.]/g, '');
  const digits = compact.replace(/^(?:\+|00)/, '');
  if (!/^\d+$/.test(digits)) return compact;
  if (compact.startsWith('+') || compact.startsWith('00')) return `+${digits}`;
  return /^2\d{7}$/.test(digits) ? `+371${digits}` : compact;
}

/**
 * BOTH points resolved and the phone valid. Connection state is deliberately
 * NOT part of this: the pill is the hook's business, and mixing it in here
 * would make a pure function depend on a socket.
 */
export function isBookable(draft: BookingDraft): boolean {
  return (
    draft.pickup.point !== null &&
    draft.destination.point !== null &&
    phoneSchema.safeParse(normalizePhone(draft.phone)).success
  );
}

/** Nothing typed anywhere — what "the draft is empty" means to the form. */
export function isEmptyDraft(draft: BookingDraft): boolean {
  return (
    draft.phone === '' &&
    draft.callerName === '' &&
    draft.pickup.text === '' &&
    draft.destination.text === '' &&
    draft.note === ''
  );
}

// The SHARED schema, not a hand-written twin: its `address` minimum and its
// lat/lng bounds are the difference between a restored draft that looks
// bookable and one the api will actually accept. A local copy drifts silently,
// and the drift surfaces as a generic failure at a dispatcher mid-call.
const draftAddressSchema = z.object({
  text: z.string(),
  point: addressPointSchema.nullable(),
  placeId: z.string().nullable(),
  resolvedAtMs: z.number().nullable(),
});

const draftSchema = z.object({
  idempotencyKey: z.string().min(1),
  phone: z.string(),
  callerName: z.string(),
  pickup: draftAddressSchema,
  destination: draftAddressSchema,
  note: z.string(),
  paymentMethod: z.enum(['cash', 'card']),
  prefilledFrom: z.enum(['venue', 'recent']).nullable(),
});

export const serializeDraft = (draft: BookingDraft): string =>
  JSON.stringify(draft);

/**
 * PARSED on read, never cast — the same rule the board applies to its cached
 * frame. A draft written by an older build is dropped rather than fed
 * half-shaped into a booking, and `expireStalePoints` runs on whatever
 * survives.
 */
export function deserializeDraft(
  raw: string,
  nowMs: number,
): BookingDraft | null {
  try {
    const parsed = draftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? expireStalePoints(parsed.data, nowMs) : null;
  } catch {
    return null;
  }
}

/**
 * The api's error codes in Dina's words. An UNMAPPED code renders the generic
 * key — the raw code never reaches the screen, the same rule
 * `assignErrorKey` follows.
 */
export function bookingErrorKey(code: string | undefined): MessageKey {
  switch (code) {
    case 'phone_belongs_to_staff':
      return 'console.booking_error_phone_belongs_to_staff';
    case 'too_many_requests':
      return 'console.booking_error_too_many_requests';
    default:
      return 'console.booking_failed';
  }
}
