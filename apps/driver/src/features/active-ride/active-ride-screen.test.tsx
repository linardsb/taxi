import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { Linking } from 'react-native';
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
jest.mock('./use-active-ride', () => ({
  useActiveRide: () => ({
    state: mockState,
    open: jest.fn(),
    step: mockStep,
    reload: mockReload,
    dismissNotice: jest.fn(),
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
