import type {
  AddressPoint,
  BookablePaymentMethod,
  FareQuote,
} from '@taxi/shared';

export type QuoteState = 'idle' | 'loading' | 'ready' | 'failed';

export interface BookingDraft {
  pickup: AddressPoint | null;
  dropoff: AddressPoint | null;
  /** The provider place id behind `dropoff`, kept so a save is a free re-resolve. */
  dropoffPlaceId: string | null;
  paymentMethod: BookablePaymentMethod;
  quote: FareQuote | null;
  quoteState: QuoteState;
  quoteErrorCode: string | null;
  /**
   * The booking attempt's `Idempotency-Key`. One per ATTEMPT, reused across
   * every retry of that attempt — see `bookingDraftReducer` for the rule that
   * decides when an attempt is over.
   */
  idempotencyKey: string;
  /** Monotonic; a quote response tagged with an older id is dropped. */
  quoteRequestId: number;
}

export type BookingAction =
  | { type: 'setPickup'; point: AddressPoint | null }
  /** The device's fix — applied only while the rider has chosen nothing. */
  | { type: 'setPickupIfEmpty'; point: AddressPoint }
  | { type: 'setDropoff'; point: AddressPoint | null; placeId: string | null }
  | { type: 'setPaymentMethod'; paymentMethod: BookablePaymentMethod }
  | { type: 'quoteRequested' }
  | { type: 'quoteArrived'; quote: FareQuote; requestId: number }
  | { type: 'quoteFailed'; code: string; requestId: number }
  | { type: 'quoteRetry' };

export function initialDraft(idempotencyKey: string): BookingDraft {
  return {
    pickup: null,
    dropoff: null,
    dropoffPlaceId: null,
    paymentMethod: 'cash',
    quote: null,
    quoteState: 'idle',
    quoteErrorCode: null,
    idempotencyKey,
    quoteRequestId: 0,
  };
}

/**
 * The booking draft, as a pure reducer so its transitions are exhaustively
 * testable — the `presence-state.ts` split in the driver app, for the same
 * reason.
 *
 * TWO RULES CARRY THE WHOLE THING:
 *
 * 1. ANY change to `pickup` or `dropoff` DISCARDS the quote AND MINTS A FRESH
 *    `idempotencyKey`. `idempotency.ts` is explicit about why: "Reusing a key
 *    after the rider edits the pickup returns the ride the OLD body created;
 *    the key is the whole contract, and the server does not re-read the body to
 *    second-guess it." A stale key here books the wrong ride, silently, and
 *    nothing downstream can catch it.
 *
 * 2. Changing `paymentMethod` does NEITHER. The fare is identical for cash and
 *    card (`docs/research/rider-ux-evidence.md` §7 — diverging prices are what
 *    creates distrust), so there is nothing to re-quote; and the key covers the
 *    booking ATTEMPT, not the payment choice, so minting a new one would turn a
 *    retry into a second car.
 *
 * 3. `quoteRetry` RE-OPENS an attempt without ending it. Rule 1 is about the
 *    corridor changing; a failed quote changes nothing, so the key is preserved
 *    and only `quoteState` goes back to `idle` for `useQuote` to fire again.
 *    Routing a retry through `setPickup` would satisfy the letter of rule 1 and
 *    break its purpose — a new key for a body nobody edited.
 */
export function bookingDraftReducer(
  state: BookingDraft,
  action: BookingAction,
  newKey: () => string,
): BookingDraft {
  switch (action.type) {
    case 'setPickup':
      return withFreshAttempt({ ...state, pickup: action.point }, newKey);
    case 'setPickupIfEmpty':
      // The device's fix NEVER overwrites a pickup the rider chose. `/book` is
      // PUSHED OVER rather than unmounted when the search sheet opens, so the
      // mount effect's `cancelled` flag never fires and a slow fix can land
      // minutes later — on top of a hand-picked address, discarding the quote,
      // minting a new key and silently re-quoting a corridor nobody chose.
      return state.pickup === null
        ? withFreshAttempt({ ...state, pickup: action.point }, newKey)
        : state;
    case 'setDropoff':
      return withFreshAttempt(
        { ...state, dropoff: action.point, dropoffPlaceId: action.placeId },
        newKey,
      );
    case 'setPaymentMethod':
      return { ...state, paymentMethod: action.paymentMethod };
    case 'quoteRequested':
      return {
        ...state,
        quoteState: 'loading',
        quoteErrorCode: null,
        quoteRequestId: state.quoteRequestId + 1,
      };
    case 'quoteArrived':
      // A late response from a superseded request must never overwrite a newer
      // quote — the classic race, and the reason for the request id.
      return action.requestId !== state.quoteRequestId
        ? state
        : { ...state, quote: action.quote, quoteState: 'ready' };
    case 'quoteFailed':
      return action.requestId !== state.quoteRequestId
        ? state
        : {
            ...state,
            quote: null,
            quoteState: 'failed',
            quoteErrorCode: action.code,
          };
    case 'quoteRetry':
      // Only out of `failed`, so a stray tap cannot cancel a quote in flight or
      // discard a good one. The key is NOT rotated — see rule 3.
      return state.quoteState !== 'failed'
        ? state
        : { ...state, quoteState: 'idle', quoteErrorCode: null };
  }
}

/** A corridor change ends the attempt: the old quote is wrong and the old key
 *  belongs to a body nobody is sending any more. */
function withFreshAttempt(
  state: BookingDraft,
  newKey: () => string,
): BookingDraft {
  return {
    ...state,
    quote: null,
    quoteState: 'idle',
    quoteErrorCode: null,
    idempotencyKey: newKey(),
  };
}

/** Both ends present and a live quote — the only state `Book` may be enabled in. */
export function isBookable(draft: BookingDraft): boolean {
  return (
    draft.pickup !== null &&
    draft.dropoff !== null &&
    draft.quoteState === 'ready'
  );
}
