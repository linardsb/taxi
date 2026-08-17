import type { AddressPoint, AddressSuggestion } from '@taxi/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOKING_DRAFT_STORAGE_KEY } from '@/features/auth';
import { BookingForm } from './booking-form';

const PICKUP: AddressPoint = {
  location: { lat: 56.9496, lng: 24.1052 },
  address: 'Kaļķu iela 28, Rīga',
};
const DESTINATION: AddressPoint = {
  location: { lat: 56.9236, lng: 23.9711 },
  address: 'Lidosta Rīga',
};

const SUGGESTIONS: AddressSuggestion[] = [
  { placeId: 'place-1', primaryText: 'Kaļķu iela 28', secondaryText: 'Rīga' },
];

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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

/** Fills phone, pickup and destination — the shortest bookable draft. */
async function fillBookable() {
  fireEvent.change(screen.getByLabelText('Zvanītāja tālrunis'), {
    target: { value: '+37129999000' },
  });

  const [pickup, destination] = screen.getAllByRole('combobox');
  for (const [field, point] of [
    [pickup, PICKUP],
    [destination, DESTINATION],
  ] as const) {
    api.resolvePlace.mockResolvedValueOnce(point);
    fireEvent.change(field!, { target: { value: 'kalku 28' } });
    vi.advanceTimersByTime(300);
    await waitFor(() => expect(api.searchAddress).toHaveBeenCalled());
    await waitFor(() =>
      expect(field!).toHaveAttribute('aria-expanded', 'true'),
    );
    fireEvent.keyDown(field!, { key: 'ArrowDown' });
    fireEvent.keyDown(field!, { key: 'Enter' });
    await waitFor(() => expect(field!).toHaveValue(point.address));
  }
}

describe('BookingForm', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.localStorage.clear();
    api.searchAddress.mockResolvedValue(SUGGESTIONS);
    api.resolvePlace.mockResolvedValue(PICKUP);
    api.lookupCaller.mockResolvedValue(null);
    api.listVenues.mockResolvedValue([]);
    api.book.mockResolvedValue({ rideId: 'ride-1' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('books with the keyboard alone and one idempotency key (expected — AC #5)', async () => {
    render(<BookingForm offline={false} onClose={vi.fn()} />);

    await fillBookable();

    const submit = screen.getByRole('button', { name: 'Pasūtīt' });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(api.book).toHaveBeenCalledTimes(1));
    const [body, key] = api.book.mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(body.callerPhone).toBe('+37129999000');
    expect(body.pickup).toEqual(PICKUP);
    expect(body.destination).toEqual(DESTINATION);
    expect(body.paymentMethod).toBe('cash');
    // Never a riderId: the dispatcher names the phone that rang, and the
    // server resolves who that is.
    expect(body).not.toHaveProperty('riderId');
    expect(key).toMatch(/^[0-9a-f-]{36}$/);

    await waitFor(() =>
      expect(screen.getByText('Pasūtījums izveidots')).toBeInTheDocument(),
    );
  });

  it('keeps the tab order the caller speaks in (expected — F2.4)', () => {
    const { container } = render(
      <BookingForm offline={false} onClose={vi.fn()} />,
    );

    // DOM order IS tab order here — nothing carries a tabindex. Queried off the
    // container rather than by role because the two address inputs are
    // comboboxes, not textboxes, and `getAllByRole` would not interleave them.
    const fields = [
      ...container.querySelectorAll<HTMLElement>(
        'input:not([type="radio"]), textarea',
      ),
    ];
    const order = fields.map((field) =>
      field.getAttribute('role') === 'combobox' ? 'combobox' : field.id,
    );
    // phone → caller name → pickup → destination → note, which is the order a
    // caller speaks in (evidence F2.4).
    expect(order).toEqual([
      'booking-phone',
      'booking-caller-name',
      'combobox',
      'combobox',
      'booking-note',
    ]);
  });

  it('persists the draft on every keystroke (expected — AC #9)', async () => {
    render(<BookingForm offline={false} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Zvanītāja tālrunis'), {
      target: { value: '+3712999' },
    });
    vi.advanceTimersByTime(200);

    await waitFor(() => {
      const raw = window.localStorage.getItem(BOOKING_DRAFT_STORAGE_KEY);
      expect(raw).toContain('+3712999');
    });
  });

  it('restores a draft written before a refresh (expected — AC #9)', async () => {
    window.localStorage.setItem(
      BOOKING_DRAFT_STORAGE_KEY,
      JSON.stringify({
        idempotencyKey: 'idem-restored',
        phone: '+37129999000',
        callerName: 'Anna',
        pickup: {
          text: PICKUP.address,
          point: PICKUP,
          placeId: 'place-1',
          resolvedAtMs: Date.now(),
        },
        destination: {
          text: 'Lidosta',
          point: null,
          placeId: null,
          resolvedAtMs: null,
        },
        note: 'zvana no bāra',
        paymentMethod: 'cash',
        prefilledFrom: null,
      }),
    );

    render(<BookingForm offline={false} onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByLabelText('Zvanītāja tālrunis')).toHaveValue(
        '+37129999000',
      ),
    );
    expect(screen.getByLabelText(/Piezīme šoferim/)).toHaveValue(
      'zvana no bāra',
    );
    // Half-typed and unresolved — restored as text, exactly as it was left.
    expect(screen.getAllByRole('combobox')[1]).toHaveValue('Lidosta');
  });

  it('disables booking offline WITH a reason, keeping the draft (failure — AC #9)', async () => {
    render(<BookingForm offline onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Zvanītāja tālrunis'), {
      target: { value: '+37129999000' },
    });
    fireEvent.change(screen.getAllByRole('combobox')[0]!, {
      target: { value: 'Kaļķu iela 28' },
    });
    vi.advanceTimersByTime(1_000);

    expect(screen.getByRole('button', { name: 'Pasūtīt' })).toBeDisabled();
    expect(screen.getByText(/Bezsaistē — pasūtīt nevar/)).toBeInTheDocument();
    // The typed address is still on screen and still in storage.
    expect(screen.getAllByRole('combobox')[0]).toHaveValue('Kaļķu iela 28');
    await waitFor(() =>
      expect(window.localStorage.getItem(BOOKING_DRAFT_STORAGE_KEY)).toContain(
        'Kaļķu iela 28',
      ),
    );
    expect(api.book).not.toHaveBeenCalled();
  });

  it('refuses to submit an unresolved address (edge)', async () => {
    render(<BookingForm offline={false} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Zvanītāja tālrunis'), {
      target: { value: '+37129999000' },
    });
    fireEvent.change(screen.getAllByRole('combobox')[0]!, {
      target: { value: 'Kaļķu iela 28' },
    });
    vi.advanceTimersByTime(300);

    expect(screen.getByRole('button', { name: 'Pasūtīt' })).toBeDisabled();
  });

  it('renders an api error in Dina words, never the raw code (failure)', async () => {
    const { ApiError } =
      await vi.importActual<typeof import('./booking-api')>('./booking-api');
    api.book.mockRejectedValue(new ApiError('phone_belongs_to_staff'));
    render(<BookingForm offline={false} onClose={vi.fn()} />);

    await fillBookable();
    fireEvent.click(screen.getByRole('button', { name: 'Pasūtīt' }));

    await waitFor(() =>
      expect(
        screen.getByText('Šis numurs pieder šoferim vai dispečeram'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByText(/phone_belongs_to_staff/),
    ).not.toBeInTheDocument();
  });

  it('renders the API retry window, not a literal (failure)', async () => {
    const { ApiError } =
      await vi.importActual<typeof import('./booking-api')>('./booking-api');
    // `RIDE_REQUEST_WINDOW_SECONDS` is 600 — a hardcoded "60 s" would send a
    // throttled dispatcher back ten times too early.
    api.book.mockRejectedValue(new ApiError('too_many_requests', 600));
    render(<BookingForm offline={false} onClose={vi.fn()} />);

    await fillBookable();
    fireEvent.click(screen.getByRole('button', { name: 'Pasūtīt' }));

    await waitFor(() =>
      expect(screen.getByText(/mēģiniet pēc 600 s/)).toBeInTheDocument(),
    );
  });

  it('mints a NEW idempotency key for the next order (edge)', async () => {
    render(<BookingForm offline={false} onClose={vi.fn()} />);

    await fillBookable();
    fireEvent.click(screen.getByRole('button', { name: 'Pasūtīt' }));
    await waitFor(() => expect(api.book).toHaveBeenCalledTimes(1));
    const firstKey = (api.book.mock.calls[0] as [unknown, string])[1];

    fireEvent.click(screen.getByRole('button', { name: 'Jauns pasūtījums' }));
    await fillBookable();
    fireEvent.click(screen.getByRole('button', { name: 'Pasūtīt' }));

    await waitFor(() => expect(api.book).toHaveBeenCalledTimes(2));
    const secondKey = (api.book.mock.calls[1] as [unknown, string])[1];
    // Reusing the key would replay the ride just booked instead of dispatching
    // the next caller's car.
    expect(secondKey).not.toBe(firstKey);
  });
});
