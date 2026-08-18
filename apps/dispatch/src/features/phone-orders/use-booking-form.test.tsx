import type { AddressPoint, CallerLookup } from '@taxi/shared';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOKING_DRAFT_STORAGE_KEY } from '@/features/auth';
import { AuthExpiredError } from './booking-api';
import { useBookingForm } from './use-booking-form';

/**
 * The hook's own tests — the file plan Task B15 listed and Phase B shipped
 * without.
 *
 * `booking-form.test.tsx` drives the same hook through the DOM, which covers
 * everything the dispatcher can reach with a keyboard. What it structurally
 * CANNOT reach is the state that survives the component: the draft lives in
 * `localStorage`, so "close the dialog and reopen it" is an unmount and a fresh
 * mount, and every assertion about what the second mount restores has to be
 * made here.
 */

const PICKUP: AddressPoint = {
  location: { lat: 56.9496, lng: 24.1052 },
  address: 'Kaļķu iela 28, Rīga',
};
const DESTINATION: AddressPoint = {
  location: { lat: 56.9236, lng: 23.9711 },
  address: 'Lidosta Rīga',
};

const LOOKUP: CallerLookup = {
  userId: '11111111-1111-4111-8111-111111111111',
  customer: null,
  savedPlaces: [],
  recentRides: [],
};

const { api } = vi.hoisted(() => ({
  api: {
    searchAddress: vi.fn(),
    resolvePlace: vi.fn(),
    lookupCaller: vi.fn(),
    listVenues: vi.fn(),
    book: vi.fn(),
  },
}));

vi.mock('./booking-api', async () => {
  const actual =
    await vi.importActual<typeof import('./booking-api')>('./booking-api');
  return { ...actual, ...api };
});

const { routerReplace } = vi.hoisted(() => ({ routerReplace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace }),
}));

/** Phone + both points — the shortest bookable draft, set straight on the hook. */
function fillBookable(form: { current: ReturnType<typeof useBookingForm> }) {
  act(() => form.current.setPhone('+37129999000'));
  act(() => form.current.resolveAddress('pickup', PICKUP, 'place-1'));
  act(() => form.current.resolveAddress('destination', DESTINATION, 'place-2'));
}

describe('useBookingForm', () => {
  beforeEach(() => {
    window.localStorage.clear();
    api.lookupCaller.mockResolvedValue(null);
    api.listVenues.mockResolvedValue([]);
    api.book.mockResolvedValue({ rideId: 'ride-1' });
  });

  afterEach(() => vi.clearAllMocks());

  it('mints a new key after CLOSE-and-reopen, not only «Jauns pasūtījums» (edge — C1)', async () => {
    const first = renderHook(() => useBookingForm(false));
    fillBookable(first.result);

    // THE PRECONDITION, asserted rather than assumed: the persist is debounced,
    // and a test that unmounts before it lands finds empty storage and passes
    // whatever the hook does. Dina fills this form over a phone call, so by the
    // time she books, the draft — and its key — are on disk.
    await waitFor(() =>
      expect(
        window.localStorage.getItem(BOOKING_DRAFT_STORAGE_KEY),
      ).toContain('+37129999000'),
    );

    await act(async () => {
      await first.result.current.submit();
    });
    await waitFor(() => expect(api.book).toHaveBeenCalledTimes(1));
    const firstKey = (api.book.mock.calls[0] as [unknown, string])[1];

    // «Aizvērt», NOT «Jauns pasūtījums»: the dialog unmounts, which destroys
    // `bookedRideId` while the draft survives in `localStorage`. This is the
    // repeat caller ringing back — the flow the caller panel exists for.
    first.unmount();
    const second = renderHook(() => useBookingForm(false));

    fillBookable(second.result);
    await act(async () => {
      await second.result.current.submit();
    });
    await waitFor(() => expect(api.book).toHaveBeenCalledTimes(2));
    const secondKey = (api.book.mock.calls[1] as [unknown, string])[1];

    // A reused key is rider-scoped and settled for 24 h server-side, so the
    // second booking REPLAYS the first ride: the console renders success
    // carrying the old ride id and no car is dispatched for this call.
    expect(secondKey).not.toBe(firstKey);
  });

  it('leaves no caller PII in storage after a booking succeeds (edge — C1)', async () => {
    const { result } = renderHook(() => useBookingForm(false));
    act(() => result.current.setCallerName('Anna Ozola'));
    fillBookable(result);

    // Again the precondition first — the PII has to BE there for its absence
    // afterwards to mean anything.
    await waitFor(() => {
      const raw = window.localStorage.getItem(BOOKING_DRAFT_STORAGE_KEY) ?? '';
      expect(raw).toContain('Anna Ozola');
      expect(raw).toContain(PICKUP.address);
    });

    await act(async () => {
      await result.current.submit();
    });
    await waitFor(() => expect(result.current.bookedRideId).toBe('ride-1'));

    // `session.ts` states the PII claim on this key; only `clearSession()` was
    // honouring it, so a completed booking left the caller's phone, name and
    // both addresses on a shared workstation until logout.
    const raw = window.localStorage.getItem(BOOKING_DRAFT_STORAGE_KEY) ?? '';
    expect(raw).not.toContain('+37129999000');
    expect(raw).not.toContain('Anna Ozola');
    expect(raw).not.toContain(PICKUP.address);
  });

  it('reports a first-time caller as none, not failed (expected — H1)', async () => {
    const { result } = renderHook(() => useBookingForm(false));
    act(() => result.current.setPhone('+37129999000'));

    // `null` is the ORDINARY answer, and it must reach the panel as the "new
    // caller" state. It arrives over the wire as an empty body; a lookup that
    // rejected on it put every first-time caller into `failed`.
    await waitFor(() => expect(result.current.lookupState).toBe('none'));
    expect(result.current.lookup).toBeNull();
  });

  it('reports a rejected lookup as failed (failure)', async () => {
    api.lookupCaller.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useBookingForm(false));
    act(() => result.current.setPhone('+37129999000'));

    await waitFor(() => expect(result.current.lookupState).toBe('failed'));
  });

  it('looks up the NORMALIZED number a dispatcher actually types (expected — M5)', async () => {
    api.lookupCaller.mockResolvedValue(LOOKUP);
    const { result } = renderHook(() => useBookingForm(false));

    // Spoken grouping and the bare local form both reach the api as E.164.
    act(() => result.current.setPhone('+371 29 999 000'));
    await waitFor(() =>
      expect(api.lookupCaller).toHaveBeenCalledWith('+37129999000'),
    );

    act(() => result.current.setPhone('29999000'));
    await waitFor(() => expect(result.current.lookup).toEqual(LOOKUP));
    expect(api.lookupCaller).toHaveBeenLastCalledWith('+37129999000');

    // And the typed text is never rewritten under the cursor.
    expect(result.current.draft.phone).toBe('29999000');
  });

  it('never shows a lookup against a number it was not made for (edge)', async () => {
    api.lookupCaller.mockResolvedValue(LOOKUP);
    const { result } = renderHook(() => useBookingForm(false));

    act(() => result.current.setPhone('+37129999000'));
    await waitFor(() => expect(result.current.lookup).toEqual(LOOKUP));

    // Dina corrects the number: the record for the OLD one must not survive
    // the edit, which is what tagging the record by phone buys.
    act(() => result.current.setPhone('+37129999001'));
    expect(result.current.lookup).toBeNull();
  });

  it('drops the session and bounces to /login when the token expired (failure)', async () => {
    api.book.mockRejectedValue(new AuthExpiredError());
    const { result } = renderHook(() => useBookingForm(false));
    fillBookable(result);

    await act(async () => {
      await result.current.submit();
    });

    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/login'));
    // An expired token is not a booking error: showing one would tell Dina to
    // retry into a login wall.
    expect(result.current.errorKey).toBeNull();
    expect(result.current.bookedRideId).toBeNull();
  });
});
