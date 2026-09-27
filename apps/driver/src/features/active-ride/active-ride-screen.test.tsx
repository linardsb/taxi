import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { AccessibilityInfo, Linking } from 'react-native';
import {
  formatMessage,
  driverRideSchema,
  type DriverRide,
  type RideStatus,
} from '@taxi/shared';
import { ActiveRideScreen } from './active-ride-screen';
import { initialActiveRide, type ActiveRideState } from './active-ride-state';

const t = (
  key: Parameters<typeof formatMessage>[1],
  params?: Record<string, string | number>,
) => formatMessage('lv', key, params);

const RIDE_ID = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
const OTHER_ID = '7c6b5a49-3827-4165-9f4e-3d2c1b0a9f8e';

const ride = (over: Partial<DriverRide> = {}): DriverRide =>
  driverRideSchema.parse({
    id: RIDE_ID,
    orderId: '11111111-2222-4333-8444-555555555555',
    status: 'accepted',
    riderId: '99999999-8888-4777-8666-555555555555',
    driverId: 'd0000000-0000-4000-8000-000000000001',
    paymentMethod: 'cash',
    request: {
      riderId: '99999999-8888-4777-8666-555555555555',
      pickup: {
        location: { lat: 56.95, lng: 24.11 },
        address: 'Brīvības iela 1',
      },
      destination: { location: { lat: 56.97, lng: 24.18 }, address: 'Teika' },
      // The immutable snapshot says card; the OPERATIVE method says cash. The
      // pill must read the operative one.
      paymentMethod: 'card',
    },
    quote: {
      model: 'upfront_fixed',
      currency: 'EUR',
      totalCents: 1240,
      breakdown: { baseCents: 300, distanceCents: 640, timeCents: 300 },
    },
    createdAt: '2026-09-04T10:00:00.000Z',
    updatedAt: '2026-09-04T10:00:00.000Z',
    rider: { displayName: 'Anna', phone: '+37120000003' },
    ...over,
  });

let mockState: ActiveRideState = initialActiveRide;
const mockStep = jest.fn();
const mockReload = jest.fn();
const mockDismiss = jest.fn();
const mockDismissNotice = jest.fn();
jest.mock('./use-active-ride', () => ({
  useActiveRide: () => ({
    state: mockState,
    open: jest.fn(),
    step: mockStep,
    reload: mockReload,
    dismissNotice: mockDismissNotice,
    dismiss: mockDismiss,
  }),
}));

const showing = (
  status: RideStatus,
  over: Partial<ActiveRideState> = {},
): ActiveRideState => ({
  ...initialActiveRide,
  rideId: RIDE_ID,
  ride: ride({ status }),
  ...over,
});

describe('ActiveRideScreen (#15)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState = initialActiveRide;
  });

  it('shows the OPERATIVE payment method in the pill, never the request snapshot (expected)', async () => {
    mockState = showing('accepted');
    await render(<ActiveRideScreen />);
    expect(screen.getByTestId('ride-payment')).toHaveTextContent(
      t('driver.ride.payment', { method: t('driver.offer.payment_cash') }),
    );
    expect(screen.getByTestId('ride-fare')).toHaveTextContent(/€12\.40/);
    expect(screen.getByTestId('nav-maps')).toBeTruthy();
  });

  it.each([
    ['accepted', 'driver.ride.title_accepted', 'driver.ride.step_arriving'],
    ['arriving', 'driver.ride.title_arriving', 'driver.ride.step_arrived'],
    ['arrived', 'driver.ride.title_arrived', 'driver.ride.step_start'],
    [
      'in_progress',
      'driver.ride.title_in_progress',
      'driver.ride.step_complete',
    ],
  ] as const)(
    'at %s the header and the one primary button follow the status (expected)',
    async (status, titleKey, stepKey) => {
      mockState = showing(status);
      await render(<ActiveRideScreen />);
      expect(screen.getByRole('header')).toHaveTextContent(t(titleKey));
      const button = screen.getByTestId('ride-step');
      expect(button).toHaveTextContent(t(stepKey));
      await fireEvent.press(button);
      expect(mockStep).toHaveBeenCalledTimes(1);
    },
  );

  it('a 409 renders the api`s code as a banner with retry and reload (failure)', async () => {
    mockState = showing('arrived', { errorCode: 'ride_not_arrived' });
    await render(<ActiveRideScreen />);
    const banner = screen.getByTestId('ride-error');
    expect(
      within(banner).getByText(t('driver.error.ride_not_arrived')),
    ).toBeTruthy();
    await fireEvent.press(
      screen.getByRole('button', { name: t('driver.action.retry') }),
    );
    expect(mockStep).toHaveBeenCalledTimes(1);
    await fireEvent.press(
      screen.getByRole('button', { name: t('driver.ride.reload') }),
    );
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  describe('the pickup PIN (#258)', () => {
    const pinnedAt = (
      status: RideStatus,
      over: Partial<ActiveRideState> = {},
    ): ActiveRideState => {
      const base = ride({ status });
      return {
        ...showing(status, over),
        ride: {
          ...base,
          request: {
            ...base.request,
            options: { ...base.request.options, pickupPin: true },
          },
        },
      };
    };

    it('shows a labelled field, and Start waits for 4 digits (expected + edge)', async () => {
      mockState = pinnedAt('arrived');
      await render(<ActiveRideScreen />);

      const field = screen.getByLabelText(t('driver.ride.pin_label'));
      expect(field.props.keyboardType).toBe('number-pad');
      expect(field.props.maxLength).toBe(4);
      expect(field.props.autoFocus).toBeUndefined();
      expect(screen.getByTestId('ride-step')).toBeDisabled();

      await fireEvent.changeText(field, '004');
      expect(screen.getByTestId('ride-step')).toBeDisabled();

      await fireEvent.changeText(field, '0042');
      expect(screen.getByTestId('ride-step')).toBeEnabled();
      await fireEvent.press(screen.getByTestId('ride-step'));
      expect(mockStep).toHaveBeenCalledWith('0042');
    });

    it('a non-digit paste is not stripped, Start stays off, and nothing is sent (failure — #280)', async () => {
      mockState = pinnedAt('arrived');
      await render(<ActiveRideScreen />);
      const field = screen.getByTestId('pickup-pin-input');

      await fireEvent.changeText(field, '12ab');
      expect(screen.getByTestId('ride-step')).toBeDisabled();
      await fireEvent.press(screen.getByTestId('ride-step'));
      expect(mockStep).not.toHaveBeenCalled();

      await fireEvent.changeText(field, '1234');
      expect(screen.getByTestId('ride-step')).toBeEnabled();
      await fireEvent.press(screen.getByTestId('ride-step'));
      expect(mockStep).toHaveBeenCalledWith('1234');
    });

    it('the field is uncontrolled, so the native text is never re-set per keystroke (regression — #280)', async () => {
      mockState = pinnedAt('arrived');
      await render(<ActiveRideScreen />);
      const field = screen.getByTestId('pickup-pin-input');

      await fireEvent.changeText(field, '0042');
      expect(field.props.value).toBeUndefined();
      expect(field.props.defaultValue).toBeUndefined();
    });

    it('a PIN typed for one ride does not carry to the next (edge — #280)', async () => {
      mockState = pinnedAt('arrived');
      const view = await render(<ActiveRideScreen />);
      await fireEvent.changeText(
        screen.getByTestId('pickup-pin-input'),
        '0042',
      );
      expect(screen.getByTestId('ride-step')).toBeEnabled();

      // What `opened()` leaves on a force-assign: the new id, no ride yet.
      mockState = { ...initialActiveRide, rideId: OTHER_ID, loading: true };
      await view.rerender(<ActiveRideScreen />);
      expect(screen.getByTestId('ride-loading')).toBeTruthy();

      const next = pinnedAt('arrived');
      mockState = {
        ...next,
        rideId: OTHER_ID,
        ride: { ...next.ride!, id: OTHER_ID },
      };
      await view.rerender(<ActiveRideScreen />);

      expect(screen.getByTestId('ride-step')).toBeDisabled();
      await fireEvent.press(screen.getByTestId('ride-step'));
      expect(mockStep).not.toHaveBeenCalled();
    });

    it('an un-pinned ride shows no field and Start works as before (regression)', async () => {
      mockState = showing('arrived');
      await render(<ActiveRideScreen />);

      expect(screen.queryByTestId('pickup-pin-input')).toBeNull();
      expect(screen.getByTestId('ride-step')).toBeEnabled();
    });

    it('no field before arrival, even on a pinned ride (edge)', async () => {
      mockState = pinnedAt('arriving');
      await render(<ActiveRideScreen />);

      expect(screen.queryByTestId('pickup-pin-input')).toBeNull();
    });

    it('a wrong PIN shows its copy, offers no Retry, and Start waits for different digits (failure)', async () => {
      mockState = pinnedAt('arrived');
      const view = await render(<ActiveRideScreen />);
      await fireEvent.changeText(
        screen.getByTestId('pickup-pin-input'),
        '9999',
      );

      mockState = pinnedAt('arrived', {
        errorCode: 'pickup_pin_incorrect',
        rejectedPin: '9999',
      });
      await view.rerender(<ActiveRideScreen />);

      expect(
        within(screen.getByTestId('ride-error')).getByText(
          t('driver.error.pickup_pin_incorrect'),
        ),
      ).toBeTruthy();
      // Every resend of the refused digits would cost an attempt (PR #277 M1).
      expect(
        screen.queryByRole('button', { name: t('driver.action.retry') }),
      ).toBeNull();
      // The digits survive the 422, so the driver corrects rather than retypes:
      // Start is off for the refused 9999, and on for the one-digit change below.
      expect(screen.getByTestId('ride-step')).toBeDisabled();

      await fireEvent.changeText(
        screen.getByTestId('pickup-pin-input'),
        '9998',
      );
      expect(screen.getByTestId('ride-step')).toBeEnabled();
      await fireEvent.press(screen.getByTestId('ride-step'));
      expect(mockStep).toHaveBeenCalledWith('9998');
    });

    it('a network error keeps Retry, and Retry resends the typed PIN (failure — E10)', async () => {
      mockState = pinnedAt('arrived');
      const view = await render(<ActiveRideScreen />);
      await fireEvent.changeText(
        screen.getByTestId('pickup-pin-input'),
        '0042',
      );

      mockState = pinnedAt('arrived', { errorCode: 'network_error' });
      await view.rerender(<ActiveRideScreen />);

      await fireEvent.press(
        screen.getByRole('button', { name: t('driver.action.retry') }),
      );
      expect(mockStep).toHaveBeenCalledWith('0042');
    });

    it('a locked ride says to call dispatch and Start stays off (failure)', async () => {
      mockState = pinnedAt('arrived', {
        errorCode: 'pickup_pin_locked',
        pinLocked: true,
      });
      await render(<ActiveRideScreen />);

      expect(
        within(screen.getByTestId('ride-error')).getByText(
          t('driver.error.pickup_pin_locked'),
        ),
      ).toBeTruthy();
      expect(
        screen.queryByRole('button', { name: t('driver.action.retry') }),
      ).toBeNull();
      await fireEvent.changeText(
        screen.getByTestId('pickup-pin-input'),
        '1234',
      );
      expect(screen.getByTestId('ride-step')).toBeDisabled();
    });
  });

  it('a released ride shows the banner and a done button, no step button (edge)', async () => {
    mockState = showing('requested', {
      ended: { kind: 'released', reason: null },
    });
    await render(<ActiveRideScreen />);
    expect(screen.getByTestId('ended-banner')).toHaveTextContent(
      t('driver.ride.released'),
    );
    expect(screen.queryByTestId('ride-step')).toBeNull();
    await fireEvent.press(screen.getByTestId('ride-done'));
    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });

  it('the payment-changed notice is a warning banner naming the LOCKED method (edge, R2)', async () => {
    mockState = showing('accepted', {
      notice: 'payment_changed',
      ride: ride({ paymentMethod: 'card' }),
    });
    await render(<ActiveRideScreen />);
    expect(
      within(screen.getByTestId('payment-changed')).getByText(
        t('driver.ride.payment_changed', {
          method: t('driver.offer.payment_card'),
        }),
      ),
    ).toBeTruthy();
    expect(screen.getByTestId('ride-payment')).toHaveTextContent(
      t('driver.ride.payment', { method: t('driver.offer.payment_card') }),
    );
  });

  it('with nothing open it redirects home; while loading it spins (edge)', async () => {
    await render(<ActiveRideScreen />);
    expect(screen.getByTestId('redirect')).toHaveTextContent('/home');

    mockState = { ...initialActiveRide, rideId: RIDE_ID, loading: true };
    await screen.unmount();
    await render(<ActiveRideScreen />);
    expect(screen.getByTestId('ride-loading')).toBeTruthy();
  });
});

describe('ActiveRideScreen rider identity (#261)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState = initialActiveRide;
  });
  afterEach(() => jest.restoreAllMocks());

  it('at arrived shows the name and a call button that dials the rider (expected)', async () => {
    const openURL = jest
      .spyOn(Linking, 'openURL')
      .mockImplementation(() => Promise.resolve(true));
    mockState = showing('arrived');
    await render(<ActiveRideScreen />);
    expect(screen.getByTestId('rider-name')).toHaveTextContent(
      t('driver.ride.rider_name', { name: 'Anna' }),
    );
    const call = screen.getByRole('button', {
      name: t('driver.ride.call_rider'),
    });
    // The number is dialled, never spoken: it is in neither label nor hint.
    expect(call.props.accessibilityLabel).not.toMatch(/\d/);
    expect(call.props.accessibilityHint).toBe(
      t('driver.ride.call_rider_hint', { name: 'Anna' }),
    );
    await fireEvent.press(call);
    expect(openURL).toHaveBeenCalledWith('tel:+37120000003');
  });

  it('hides the call button at in_progress although the phone is still in memory (edge — the client gate)', async () => {
    // What a local `step_done` leaves behind: status moved, block not re-read.
    mockState = showing('in_progress');
    expect(mockState.ride?.rider.phone).toBe('+37120000003');
    await render(<ActiveRideScreen />);
    expect(screen.queryByTestId('call-rider')).toBeNull();
    expect(screen.getByTestId('rider-name')).toHaveTextContent(
      t('driver.ride.rider_name', { name: 'Anna' }),
    );
  });

  it('with no name shows no name line and no hint, and a refused dialler is swallowed (failure)', async () => {
    const openURL = jest
      .spyOn(Linking, 'openURL')
      .mockImplementation(() => Promise.reject(new Error('no dialler')));
    mockState = showing('accepted', {
      ride: ride({
        status: 'accepted',
        rider: { displayName: null, phone: '+37120000003' },
      }),
    });
    await render(<ActiveRideScreen />);
    expect(screen.queryByTestId('rider-name')).toBeNull();
    const call = screen.getByTestId('call-rider');
    expect(call.props.accessibilityHint).toBeUndefined();
    await fireEvent.press(call);
    await act(async () => {
      await Promise.resolve();
    });
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('ride-error')).toBeNull();
  });

  it('with no phone in the window shows no call button (edge)', async () => {
    mockState = showing('arriving', {
      ride: ride({
        status: 'arriving',
        rider: { displayName: 'Anna', phone: null },
      }),
    });
    await render(<ActiveRideScreen />);
    expect(screen.queryByTestId('call-rider')).toBeNull();
  });
});

/**
 * #259 T0: the reducer's `announce` effects are the one speaker for these
 * events — they run app-wide, so they still speak after hardware back has
 * unmounted this screen. The Banners showing the same text stay silent, or
 * both platforms say it twice now that Banner announces on Android too.
 */
describe('ActiveRideScreen Banners the reducer already speaks (#259 T0)', () => {
  let announce: jest.SpyInstance;
  beforeEach(() => {
    announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation();
  });
  afterEach(() => announce.mockRestore());

  it.each([
    [
      'payment-changed (P1)',
      () => showing('accepted', { notice: 'payment_changed' }),
      'payment-changed',
    ],
    [
      'released (P2)',
      () => showing('requested', { ended: { kind: 'released', reason: null } }),
      'ended-banner',
    ],
    [
      'cancelled (P3)',
      () =>
        showing('cancelled_by_rider', {
          ended: { kind: 'cancelled', reason: 'changed plans' },
        }),
      'ended-banner',
    ],
  ] as const)(
    'the %s Banner renders without announcing (edge)',
    async (_name, state, testID) => {
      mockState = state();
      await render(<ActiveRideScreen />);
      expect(screen.getByTestId(testID)).toBeTruthy();
      expect(announce).not.toHaveBeenCalled();
    },
  );

  it('the completed-without-split Banner (P4) renders without announcing (edge)', async () => {
    const done = ride({ status: 'completed', split: null });
    mockState = showing('completed', {
      ride: done,
      ended: { kind: 'completed', ride: done },
    });
    await render(<ActiveRideScreen />);
    expect(screen.getByText(t('driver.ride.reload'))).toBeTruthy();
    expect(announce).not.toHaveBeenCalled();
  });
});

describe('ActiveRideScreen arrival-announce protocol (#259)', () => {
  let announce: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation();
  });
  afterEach(() => announce.mockRestore());

  const flagged = (
    status: RideStatus,
    displayName: string | null = 'Anna',
  ): DriverRide => {
    const base = ride({ status, rider: { displayName, phone: null } });
    return {
      ...base,
      request: {
        ...base.request,
        options: { ...base.request.options, announceArrival: true },
      },
    };
  };
  const show = (r: DriverRide, over: Partial<ActiveRideState> = {}) => {
    mockState = { ...initialActiveRide, rideId: r.id, ride: r, ...over };
  };

  it('at arrived tells the driver to call out the rider`s name — the same name the name line shows (expected — D4)', async () => {
    show(flagged('arrived'));
    await render(<ActiveRideScreen />);
    expect(screen.getByTestId('announce-prompt')).toHaveTextContent(
      t('driver.ride.announce_prompt_name', { name: 'Anna' }),
    );
    expect(screen.getByTestId('rider-name')).toHaveTextContent(
      t('driver.ride.rider_name', { name: 'Anna' }),
    );
  });

  it('with no name, calls out the destination instead (edge — D4)', async () => {
    show(flagged('arrived', null));
    await render(<ActiveRideScreen />);
    expect(screen.getByTestId('announce-prompt')).toHaveTextContent(
      t('driver.ride.announce_prompt_destination', { address: 'Teika' }),
    );
  });

  it('before arrival shows the note, and a flag-less ride shows nothing (edge)', async () => {
    show(flagged('arriving'));
    const { rerender } = await render(<ActiveRideScreen />);
    expect(screen.getByTestId('announce-prompt')).toHaveTextContent(
      t('driver.ride.announce_note'),
    );

    show(ride({ status: 'arrived' }));
    await rerender(<ActiveRideScreen />);
    expect(screen.queryByTestId('announce-prompt')).toBeNull();
  });

  it('the request notice is a silent Banner, and «Gatavs» dismisses it (expected)', async () => {
    show(flagged('arrived'), { notice: 'announce_requested' });
    await render(<ActiveRideScreen />);

    const notice = screen.getByTestId('announce-requested');
    expect(notice).toHaveTextContent(t('driver.ride.announce_requested'), {
      exact: false,
    });
    // The reducer's effect is the speaker (T0's rule), not the Banner.
    expect(announce).not.toHaveBeenCalled();
    await fireEvent.press(
      within(notice).getByRole('button', { name: t('driver.action.done') }),
    );
    expect(mockDismissNotice).toHaveBeenCalledTimes(1);
  });
});
