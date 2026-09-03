import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { formatMessage } from '@taxi/shared';
import * as Location from 'expo-location';
import { AccessibilityInfo } from 'react-native';
import { ApiError } from '@/features/auth';
import { SearchSheet } from './search-sheet';

const mockRequest = jest.fn();
jest.mock('@/features/auth', () => ({
  ...jest.requireActual<typeof import('@/features/auth')>('@/features/auth'),
  useSession: () => ({
    state: { status: 'signedOut', session: null },
    api: { request: mockRequest },
    signIn: jest.fn(),
    signOut: jest.fn(),
    onBeforeSignOut: jest.fn(),
  }),
}));

const router = jest.requireMock<typeof import('expo-router')>('expo-router');
const { navigate } = router.useRouter() as unknown as { navigate: jest.Mock };

const SUGGESTION = {
  placeId: 'place-1',
  primaryText: 'Brīvības iela 45',
  secondaryText: 'Rīga, Latvija',
};
const POINT = {
  location: { lat: 56.9496, lng: 24.1052 },
  address: 'Brīvības iela 45, Rīga',
};

const t = (
  key: Parameters<typeof formatMessage>[1],
  p?: Record<string, string | number>,
) => formatMessage('lv', key, p);

/** Types, then lets the 300 ms debounce elapse. */
async function type(text: string) {
  // `fireEvent`, not `userEvent`: RNTL's user events schedule their own delays
  // on the timers this file is faking to drive the debounce.
  await fireEvent.changeText(
    screen.getByLabelText(t('rider.address.search_label')),
    text,
  );
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
}

/** The query string the sheet sends, so a test can read the session token back. */
const sessionOf = (call: unknown[]): string =>
  new URL(`http://x${String(call[1])}`).searchParams.get('session') ?? '';

describe('SearchSheet', () => {
  let focusSpy: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers({
      doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'],
    });
    focusSpy = jest
      .spyOn(AccessibilityInfo, 'setAccessibilityFocus')
      .mockImplementation();
    mockRequest.mockReset();
    navigate.mockReset();
    (router.useLocalSearchParams as jest.Mock).mockReturnValue({
      field: 'dropoff',
    });
  });
  afterEach(() => {
    focusSpy.mockRestore();
    jest.useRealTimers();
  });

  it('searches, resolves the tapped row and hands the point back to /book (expected)', async () => {
    mockRequest
      .mockResolvedValueOnce([SUGGESTION])
      .mockResolvedValueOnce(POINT);
    await render(<SearchSheet />);

    await type('Brīvības');
    const row = await screen.findByRole('button', {
      name: 'Brīvības iela 45, Rīga, Latvija',
    });
    await fireEvent.press(row);

    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    // A suggestion is NOT bookable — only the resolve returns a `location`.
    expect(navigate).toHaveBeenCalledWith({
      pathname: '/book',
      params: {
        field: 'dropoff',
        address: POINT.address,
        lat: '56.9496',
        lng: '24.1052',
        placeId: 'place-1',
      },
    });
  });

  it('spends nothing below the minimum length and says why (edge)', async () => {
    await render(<SearchSheet />);

    await type('Br');

    expect(mockRequest).not.toHaveBeenCalled();
    expect(
      screen.getByText(t('rider.book.min_chars', { count: 3 })),
    ).toBeTruthy();
  });

  it('reuses ONE session token across a field visit and rotates it after a resolve (edge)', async () => {
    mockRequest
      .mockResolvedValueOnce([SUGGESTION])
      .mockResolvedValueOnce([SUGGESTION])
      .mockResolvedValueOnce(POINT);
    await render(<SearchSheet />);

    await type('Brī');
    await type('vības');
    const first = sessionOf(mockRequest.mock.calls[0]!);
    // Reuse is what collapses a burst of autocomplete requests into ONE billed
    // session; minting per keystroke would bill each separately.
    expect(sessionOf(mockRequest.mock.calls[1]!)).toBe(first);

    await fireEvent.press(
      await screen.findByRole('button', {
        name: 'Brīvības iela 45, Rīga, Latvija',
      }),
    );
    await waitFor(() => expect(navigate).toHaveBeenCalled());

    const resolveBody = mockRequest.mock.calls[2]![2] as {
      body: { session: string };
    };
    expect(resolveBody.body.session).toBe(first);
  });

  it('drops a place the provider has forgotten and says to search again (failure — E9)', async () => {
    mockRequest
      .mockResolvedValueOnce([SUGGESTION])
      .mockRejectedValueOnce(new ApiError(404, 'place_not_found'));
    await render(<SearchSheet />);

    await type('Brīvības');
    await fireEvent.press(
      await screen.findByRole('button', {
        name: 'Brīvības iela 45, Rīga, Latvija',
      }),
    );

    await screen.findByText(t('rider.error.place_not_found'));
    // The row goes: a place that no longer exists cannot be tapped again.
    await waitFor(() =>
      expect(
        screen.queryByRole('button', {
          name: 'Brīvības iela 45, Rīga, Latvija',
        }),
      ).toBeNull(),
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps the session open when a 429 stopped the resolve reaching the provider (failure — E4)', async () => {
    mockRequest
      .mockResolvedValueOnce([SUGGESTION])
      .mockRejectedValueOnce(new ApiError(429, 'too_many_requests', 30))
      .mockResolvedValueOnce([SUGGESTION]);
    await render(<SearchSheet />);

    await type('Brīvības');
    const opened = sessionOf(mockRequest.mock.calls[0]!);
    await fireEvent.press(
      await screen.findByRole('button', {
        name: 'Brīvības iela 45, Rīga, Latvija',
      }),
    );
    await screen.findByText(t('rider.error.too_many_requests'), {
      exact: false,
    });
    // Past the cooldown the field searches again — and must do so on the SAME
    // session, because the throttled resolve never reached the provider.
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });

    await type('Brīvības 2');

    // Rotating here would ABANDON the session this resolve was about to close,
    // turning a $5.00/1,000 completion into 5 × $2.83 individual requests —
    // the console's `.catch` bug, not repeated.
    expect(sessionOf(mockRequest.mock.calls[2]!)).toBe(opened);
  });

  it('counts the 429 down and spends nothing while it does (failure — E4, the Error state)', async () => {
    mockRequest
      .mockRejectedValueOnce(new ApiError(429, 'too_many_requests', 30))
      .mockResolvedValue([SUGGESTION]);
    await render(<SearchSheet />);

    await type('Brīvības');

    await screen.findByText(
      `${t('rider.error.too_many_requests')} ${t('rider.book.retry_in', {
        seconds: 30,
      })}`,
    );
    // No auto-retry: retrying is what produced the throttle, and the cap it hit
    // is a money control.
    await type('Brīvības iela');
    expect(mockRequest).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    await type('Brīvības iela 45');
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('speaks the result count on iOS, where a live region says nothing (a11y — H4)', async () => {
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation();
    try {
      mockRequest.mockResolvedValueOnce([SUGGESTION]);
      await render(<SearchSheet />);

      await type('Brīvības');

      // The list itself is silent. Before this the line went «Meklē…» → `''`
      // on results, so a blind rider heard NOTHING at the one moment the screen
      // changed — and `accessibilityLiveRegion` is Android-only, so on iOS they
      // heard nothing at any moment.
      const line = t('rider.address.results_count', { count: 1 });
      await screen.findByText(line);
      await waitFor(() => expect(announce).toHaveBeenCalledWith(line));
    } finally {
      announce.mockRestore();
    }
  });

  it('ignores a response the rider has already typed past (failure — M2)', async () => {
    let answerFirst: (rows: unknown) => void = () => undefined;
    mockRequest
      .mockReturnValueOnce(
        new Promise((resolve) => {
          answerFirst = resolve;
        }),
      )
      .mockResolvedValueOnce([SUGGESTION]);

    await render(<SearchSheet />);
    await type('Brī');
    await type('Brīvības');
    await screen.findByRole('button', {
      name: 'Brīvības iela 45, Rīga, Latvija',
    });

    // «Brī» answers AFTER «Brīvības» — the classic out-of-order reply.
    await act(async () => answerFirst([]));

    // Its `[]` must not wipe the live list. It did: `current` then evaluated to
    // null (the queries no longer matched) and the line fell back to «Meklē…»
    // with no request in flight, which the rider could only escape by typing
    // another character.
    expect(
      screen.getByRole('button', { name: 'Brīvības iela 45, Rīga, Latvija' }),
    ).toBeTruthy();
    expect(screen.queryByText(t('rider.book.searching'))).toBeNull();
  });

  it('retires a failure banner once a search succeeds (failure — L1)', async () => {
    mockRequest
      .mockRejectedValueOnce(new ApiError(500, 'generic'))
      .mockResolvedValueOnce([SUGGESTION]);

    await render(<SearchSheet />);
    await type('Brīvības');
    await screen.findByText(t('rider.error.generic'));

    await type('Brīvības iela');

    // A dead banner over a healthy list — and on iOS `Banner` re-announces the
    // stale text every time it re-renders.
    await waitFor(() =>
      expect(screen.queryByText(t('rider.error.generic'))).toBeNull(),
    );
    await screen.findByRole('button', {
      name: 'Brīvības iela 45, Rīga, Latvija',
    });
  });

  it('says location is unavailable rather than that the app broke (failure — M8, D7)', async () => {
    (router.useLocalSearchParams as jest.Mock).mockReturnValue({
      field: 'pickup',
    });
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue(
      { status: 'denied' },
    );
    await render(<SearchSheet />);

    await fireEvent.press(
      screen.getByRole('button', {
        name: t('rider.book.use_current_location'),
      }),
    );

    // `null` is an ORDINARY outcome (D7). «Kaut kas nogāja greizi. Mēģiniet
    // vēlreiz.» tells a rider who deliberately refused location that the app
    // broke, and invites a retry that fails identically.
    await screen.findByText(t('rider.book.location_unavailable'));
    expect(screen.queryByText(t('rider.error.generic'))).toBeNull();
  });

  it('has one header and moves focus to it on mount (a11y — property 1)', async () => {
    await render(<SearchSheet />);

    expect(screen.getAllByRole('header')).toHaveLength(1);
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });
});
