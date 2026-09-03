import { useCallback, useMemo, useReducer } from 'react';
import { newUuid } from '@/uuid';
import {
  bookingDraftReducer,
  initialDraft,
  type BookingAction,
  type BookingDraft,
} from './booking-draft';

export interface BookingDraftApi {
  draft: BookingDraft;
  dispatch: (action: BookingAction) => void;
}

/**
 * The draft, bound to a uuid minter. The reducer takes the minter as an
 * argument rather than calling `newUuid` itself so it stays pure and its
 * key-rotation rule is testable without a native module.
 */
export function useBookingDraft(
  newKey: () => string = newUuid,
): BookingDraftApi {
  const reducer = useCallback(
    (state: BookingDraft, action: BookingAction) =>
      bookingDraftReducer(state, action, newKey),
    [newKey],
  );
  const [draft, dispatch] = useReducer(reducer, undefined, () =>
    initialDraft(newKey()),
  );
  return useMemo(() => ({ draft, dispatch }), [draft]);
}
