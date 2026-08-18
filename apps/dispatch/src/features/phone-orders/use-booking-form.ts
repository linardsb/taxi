'use client';

import {
  phoneSchema,
  type AddressPoint,
  type CallerLookup,
  type DispatcherBookingBody,
  type MessageKey,
  type VenueEntry,
} from '@taxi/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BOOKING_DRAFT_STORAGE_KEY, clearSession } from '@/features/auth';
import {
  ApiError,
  AuthExpiredError,
  book,
  listVenues,
  lookupCaller,
} from './booking-api';
import {
  bookingErrorKey,
  deserializeDraft,
  emptyDraft,
  isBookable,
  normalizePhone,
  serializeDraft,
  setAddressPoint,
  setAddressText,
  type AddressField,
  type BookingDraft,
} from './booking-draft';
import { newUuid } from './ids';

/**
 * Persist cadence. Every KEYSTROKE, debounced — not on blur.
 *
 * The ledger row is "Booking form data lost on disconnect/refresh: 0", and
 * blur-only persistence loses the field being typed, which is the one field
 * that matters when the console reloads under a dispatcher mid-call. 200 ms is
 * short enough that a browser crash costs at most one word.
 */
const PERSIST_MS = 200;

/** Caller lookup fires once the number is plausibly complete, not per digit. */
const LOOKUP_MS = 400;

/** A lookup, tagged with the number it was made for. */
interface LookupRecord {
  phone: string;
  status: 'searching' | 'done' | 'failed';
  value: CallerLookup | null;
}

/**
 * Drops the persisted draft NOW, without waiting for the debounce.
 *
 * The persist effect is a 200 ms timer cleared on unmount, so a dispatcher who
 * closes the dialog straight after booking would otherwise cancel the write
 * that was going to clear the spent key and the caller's details.
 */
function clearStoredDraft(): void {
  try {
    window.localStorage.removeItem(BOOKING_DRAFT_STORAGE_KEY);
  } catch {
    // A storage write can throw in a locked-down browser profile — the same
    // rule the persist effect follows. The in-memory draft is already fresh.
  }
}

/** The persisted draft, or a fresh one. Runs client-side only — see below. */
function restoreDraft(): BookingDraft {
  try {
    const raw = window.localStorage.getItem(BOOKING_DRAFT_STORAGE_KEY);
    const restored = raw === null ? null : deserializeDraft(raw, Date.now());
    return restored ?? emptyDraft(newUuid());
  } catch {
    // A storage read can throw in a locked-down browser profile. A form that
    // opens empty beats a form that does not open.
    return emptyDraft(newUuid());
  }
}

export interface BookingForm {
  draft: BookingDraft;
  lookup: CallerLookup | null;
  lookupState: 'idle' | 'searching' | 'none' | 'failed';
  venues: VenueEntry[];
  submitting: boolean;
  errorKey: MessageKey | null;
  /** The api's own retry window, for the one message that interpolates it. */
  errorRetrySeconds: number | null;
  bookedRideId: string | null;
  setPhone: (phone: string) => void;
  setCallerName: (name: string) => void;
  setNote: (note: string) => void;
  setPaymentMethod: (method: 'cash' | 'card') => void;
  setAddressTextFor: (field: AddressField, text: string) => void;
  resolveAddress: (
    field: AddressField,
    point: AddressPoint,
    placeId: string | null,
  ) => void;
  prefillFrom: (
    source: 'venue' | 'recent',
    pickup: AddressPoint,
    destination?: AddressPoint,
  ) => void;
  submit: () => Promise<void>;
  reset: () => void;
  bookable: boolean;
}

/**
 * Wires draft ↔ caller lookup ↔ submit. Effects live here; every decision they
 * make lives in `booking-draft.ts`, which is why that module has no React in
 * it and this one has no branching worth testing on its own.
 */
export function useBookingForm(offline: boolean): BookingForm {
  const router = useRouter();
  /**
   * Restored in the INITIALIZER, not an effect: a refresh mid-call must come
   * back with the caller's details already on screen, and restoring after the
   * first paint would flash an empty form at a dispatcher who is mid-sentence.
   *
   * Reading `window` here is safe because this hook only ever runs on the
   * client — the form is mounted by a user action (`⌥N` or the button), so it
   * is never part of a server render and cannot mismatch on hydration.
   */
  const [draft, setDraft] = useState<BookingDraft>(() => restoreDraft());
  /**
   * The lookup is keyed by the PHONE it was made for, which is what lets
   * `lookupState` be derived rather than stored. Storing it meant clearing two
   * pieces of state synchronously inside an effect every time the number
   * changed — cascading renders, and a rule the console's lint enforces.
   */
  const [lookupRecord, setLookupRecord] = useState<LookupRecord | null>(null);
  const [venues, setVenues] = useState<VenueEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [errorRetrySeconds, setErrorRetrySeconds] = useState<number | null>(
    null,
  );
  const [bookedRideId, setBookedRideId] = useState<string | null>(null);
  const inFlight = useRef(false);

  const handleAuthFailure = useCallback(() => {
    clearSession();
    router.replace('/login');
  }, [router]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        window.localStorage.setItem(
          BOOKING_DRAFT_STORAGE_KEY,
          serializeDraft(draft),
        );
      } catch {
        // A full quota must never break the form — the same rule
        // `use-board.ts:persistFrame` follows. The draft stays in memory.
      }
    }, PERSIST_MS);
    return () => clearTimeout(timer);
  }, [draft]);

  useEffect(() => {
    listVenues()
      .then(setVenues)
      .catch((error: unknown) => {
        if (error instanceof AuthExpiredError) handleAuthFailure();
        // A missing venue list is not worth an error banner: it is a shortcut,
        // and every venue is still bookable by typing the address.
      });
  }, [handleAuthFailure]);

  // NORMALIZED, not raw: the lookup and the booking both key on E.164, and a
  // dispatcher who types the number the way it is spoken («+371 29 999 000»)
  // or the way it is dialled locally («29999000») otherwise gets no caller pop
  // at all — `lookupState: 'idle'`, which on screen is indistinguishable from
  // "still typing" — and then a 400 on submit, mid-call.
  const phone = normalizePhone(draft.phone);
  const phoneValid = phoneSchema.safeParse(phone).success;

  useEffect(() => {
    if (!phoneValid) return;
    const timer = setTimeout(() => {
      setLookupRecord({ phone, status: 'searching', value: null });
      lookupCaller(phone)
        .then((value) => setLookupRecord({ phone, status: 'done', value }))
        .catch((error: unknown) => {
          if (error instanceof AuthExpiredError) {
            handleAuthFailure();
            return;
          }
          setLookupRecord({ phone, status: 'failed', value: null });
        });
    }, LOOKUP_MS);
    return () => clearTimeout(timer);
  }, [phone, phoneValid, handleAuthFailure]);

  // DERIVED, so a record for a number Dina has since edited can never be shown
  // against the new one — the bug a separately-stored `lookup` invites.
  const current = lookupRecord?.phone === phone ? lookupRecord : null;
  const lookup =
    current?.status === 'done' && current.value !== null ? current.value : null;
  const lookupState: BookingForm['lookupState'] = !phoneValid
    ? 'idle'
    : current === null || current.status === 'searching'
      ? 'searching'
      : current.status === 'failed'
        ? 'failed'
        : current.value === null
          ? 'none'
          : 'idle';

  const setPhone = useCallback(
    (value: string) => setDraft((current) => ({ ...current, phone: value })),
    [],
  );
  const setCallerName = useCallback(
    (value: string) =>
      setDraft((current) => ({ ...current, callerName: value })),
    [],
  );
  const setNote = useCallback(
    (value: string) => setDraft((current) => ({ ...current, note: value })),
    [],
  );
  const setPaymentMethod = useCallback(
    (method: 'cash' | 'card') =>
      setDraft((current) => ({ ...current, paymentMethod: method })),
    [],
  );
  const setAddressTextFor = useCallback(
    (field: AddressField, text: string) =>
      setDraft((current) => setAddressText(current, field, text)),
    [],
  );
  const resolveAddress = useCallback(
    (field: AddressField, point: AddressPoint, placeId: string | null) =>
      setDraft((current) =>
        setAddressPoint(current, field, point, placeId, Date.now()),
      ),
    [],
  );

  /**
   * STABLE FIELDS ONLY — pickup, dropoff, and (through the phone field) the
   * passenger. Never the payment method, never the note, never the category:
   * evidence F2.2's "Clean jobs" toggle exists because prefilling per-trip
   * fields produces confidently wrong bookings.
   */
  const prefillFrom = useCallback(
    (
      source: 'venue' | 'recent',
      pickup: AddressPoint,
      destination?: AddressPoint,
    ) =>
      setDraft((current) => {
        const now = Date.now();
        const withPickup = setAddressPoint(
          current,
          'pickup',
          pickup,
          null,
          now,
        );
        const filled =
          destination === undefined
            ? withPickup
            : setAddressPoint(
                withPickup,
                'destination',
                destination,
                null,
                now,
              );
        return { ...filled, prefilledFrom: source };
      }),
    [],
  );

  const reset = useCallback(() => {
    // A NEW idempotency key: the next order is a different order, and reusing
    // the key would replay the ride just booked.
    setDraft(emptyDraft(newUuid()));
    setLookupRecord(null);
    setErrorKey(null);
    setErrorRetrySeconds(null);
    setBookedRideId(null);
    clearStoredDraft();
  }, []);

  const submit = useCallback(async () => {
    if (offline || submitting || inFlight.current) return;
    if (draft.pickup.point === null || draft.destination.point === null) return;
    if (!isBookable(draft)) return;

    inFlight.current = true;
    setSubmitting(true);
    setErrorKey(null);
    setErrorRetrySeconds(null);
    try {
      const body: DispatcherBookingBody = {
        callerPhone: normalizePhone(draft.phone),
        ...(draft.callerName === '' ? {} : { callerName: draft.callerName }),
        dispatcherNote: draft.note === '' ? null : draft.note,
        pickup: draft.pickup.point,
        destination: draft.destination.point,
        stops: [],
        category: 'standard',
        options: { childSeat: false, femaleDriver: false },
        paymentMethod: draft.paymentMethod,
        vehicleCount: 1,
      };
      const { rideId } = await book(body, draft.idempotencyKey);
      setBookedRideId(rideId);
      // THE KEY IS SPENT — rotate it here, not only in `reset()`.
      //
      // `reset()` is reachable only from «Jauns pasūtījums»; «Aizvērt» beside
      // it unmounts the form, which destroys `bookedRideId` while the draft —
      // and its spent key — survive in `localStorage`. The repeat caller then
      // reopens an editable form whose key the api has already settled, so the
      // second booking replays the FIRST ride: the console shows success, and
      // no car is dispatched. Rotating on success also clears the caller's
      // phone, name and both addresses, which is the PII claim `session.ts`
      // makes and only `clearSession()` was honouring.
      //
      // Safe at this point because the success screen renders no draft field —
      // it is a title and two buttons.
      //
      // Storage is cleared SYNCHRONOUSLY as well: «Aizvērt» unmounts the form,
      // and the unmount cancels the debounced persist that would otherwise have
      // written the fresh draft — leaving the spent key on disk after all.
      setDraft(emptyDraft(newUuid()));
      clearStoredDraft();
    } catch (error: unknown) {
      if (error instanceof AuthExpiredError) {
        handleAuthFailure();
        return;
      }
      const apiError = error instanceof ApiError ? error : null;
      setErrorKey(bookingErrorKey(apiError?.code));
      setErrorRetrySeconds(apiError?.retryAfterSeconds ?? null);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }, [draft, offline, submitting, handleAuthFailure]);

  return {
    draft,
    lookup,
    lookupState,
    venues,
    submitting,
    errorKey,
    errorRetrySeconds,
    bookedRideId,
    setPhone,
    setCallerName,
    setNote,
    setPaymentMethod,
    setAddressTextFor,
    resolveAddress,
    prefillFrom,
    submit,
    reset,
    bookable: isBookable(draft) && !offline,
  };
}
