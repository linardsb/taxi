import {
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
 * BOTH points resolved and the phone valid. Connection state is deliberately
 * NOT part of this: the pill is the hook's business, and mixing it in here
 * would make a pure function depend on a socket.
 */
export function isBookable(draft: BookingDraft): boolean {
  return (
    draft.pickup.point !== null &&
    draft.destination.point !== null &&
    phoneSchema.safeParse(draft.phone).success
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

const draftAddressSchema = z.object({
  text: z.string(),
  point: z
    .object({
      location: z.object({ lat: z.number(), lng: z.number() }),
      address: z.string(),
    })
    .nullable(),
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
