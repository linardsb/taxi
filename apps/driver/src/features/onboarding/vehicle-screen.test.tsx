import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { formatMessage } from '@taxi/shared';
import { ApiError } from '@/features/auth';
import { VehicleScreen } from './vehicle-screen';

const mockCreateVehicle = jest.fn();
const mockUpdateVehicle = jest.fn();
let mockVehicles: unknown[] = [];
jest.mock('./use-me', () => ({
  useMe: () => ({
    me: { profile: {}, vehicles: mockVehicles },
    status: 'ready',
    refetch: jest.fn(),
    patchProfile: jest.fn(),
    createVehicle: mockCreateVehicle,
    updateVehicle: mockUpdateVehicle,
  }),
}));

const router = jest.requireMock<typeof import('expo-router')>('expo-router');
const { replace } = router.useRouter();

const t = (key: Parameters<typeof formatMessage>[1]) =>
  formatMessage('lv', key);

async function fill(
  over: Partial<
    Record<'plate' | 'make' | 'model' | 'year' | 'seats', string>
  > = {},
) {
  const values = {
    plate: 'ab-1234',
    make: 'Skoda',
    model: 'Octavia',
    year: '2019',
    seats: '4',
    ...over,
  };
  await fireEvent.changeText(
    screen.getByLabelText(t('driver.vehicle.plate')),
    values.plate,
  );
  await fireEvent.changeText(
    screen.getByLabelText(t('driver.vehicle.make')),
    values.make,
  );
  await fireEvent.changeText(
    screen.getByLabelText(t('driver.vehicle.model')),
    values.model,
  );
  await fireEvent.changeText(
    screen.getByLabelText(t('driver.vehicle.year')),
    values.year,
  );
  await fireEvent.changeText(
    screen.getByLabelText(t('driver.vehicle.seats')),
    values.seats,
  );
}

describe('VehicleScreen', () => {
  beforeEach(() => {
    mockCreateVehicle.mockReset();
    mockUpdateVehicle.mockReset();
    mockVehicles = [];
    (replace as jest.Mock).mockReset();
    (router.useLocalSearchParams as jest.Mock).mockReturnValue({});
  });

  it('submits the parsed body — plate upper-cased, numbers as numbers — and moves to documents (expected)', async () => {
    mockCreateVehicle.mockResolvedValue({ id: 'v1' });
    await render(<VehicleScreen />);

    await fill();
    await fireEvent.press(
      screen.getByRole('button', { name: t('driver.action.save') }),
    );

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/onboarding/documents'),
    );
    expect(mockCreateVehicle).toHaveBeenCalledWith({
      plate: 'AB-1234',
      make: 'Skoda',
      model: 'Octavia',
      year: 2019,
      passengerSeats: 4,
      hasChildSeat: false,
    });
  });

  it('editing sends no category and strips plate whitespace — the admin-set tier stays server-side (edge, #20)', async () => {
    mockVehicles = [
      {
        id: 'v9',
        plate: 'AB1234',
        make: 'Skoda',
        model: 'Superb',
        year: 2021,
        passengerSeats: 4,
        hasChildSeat: false,
        category: 'limo',
      },
    ];
    (router.useLocalSearchParams as jest.Mock).mockReturnValue({
      vehicleId: 'v9',
    });
    mockUpdateVehicle.mockResolvedValue({ id: 'v9' });
    await render(<VehicleScreen />);

    await fireEvent.changeText(
      screen.getByLabelText(t('driver.vehicle.plate')),
      'ab 1234',
    );
    await fireEvent.press(
      screen.getByRole('button', { name: t('driver.action.save') }),
    );

    await waitFor(() =>
      expect(mockUpdateVehicle).toHaveBeenCalledWith(
        'v9',
        expect.objectContaining({ plate: 'AB1234' }),
      ),
    );
    expect(mockUpdateVehicle.mock.calls[0]![1]).not.toHaveProperty('category');
    expect(mockCreateVehicle).not.toHaveBeenCalled();
  });

  it('the fields are uncontrolled, so typing never re-sets the native text (regression — #287)', async () => {
    mockCreateVehicle.mockResolvedValue({ id: 'v1' });
    await render(<VehicleScreen />);
    const plate = screen.getByLabelText(t('driver.vehicle.plate'));
    const seats = screen.getByLabelText(t('driver.vehicle.seats'));
    expect(plate.props.defaultValue).toBe('');
    expect(seats.props.defaultValue).toBe('4');

    await fill({ seats: '6' });

    // A `value` prop — or a `defaultValue` fed from the typed state — is what
    // makes RN re-set the native text per keystroke («tika aizstāts»).
    for (const field of [plate, seats]) {
      expect(field.props.value).toBeUndefined();
    }
    expect(plate.props.defaultValue).toBe('');
    expect(seats.props.defaultValue).toBe('4');

    await fireEvent.press(
      screen.getByRole('button', { name: t('driver.action.save') }),
    );
    await waitFor(() =>
      expect(mockCreateVehicle).toHaveBeenCalledWith(
        expect.objectContaining({ plate: 'AB-1234', passengerSeats: 6 }),
      ),
    );
  });

  it('editing prefills from the stored vehicle once and never re-feeds it (regression — #287)', async () => {
    mockVehicles = [
      {
        id: 'v9',
        plate: 'AB1234',
        make: 'Skoda',
        model: 'Superb',
        year: 2021,
        passengerSeats: 4,
        hasChildSeat: false,
        category: 'limo',
      },
    ];
    (router.useLocalSearchParams as jest.Mock).mockReturnValue({
      vehicleId: 'v9',
    });
    mockUpdateVehicle.mockResolvedValue({ id: 'v9' });
    await render(<VehicleScreen />);
    const plate = screen.getByLabelText(t('driver.vehicle.plate'));
    const seats = screen.getByLabelText(t('driver.vehicle.seats'));
    expect(plate.props.defaultValue).toBe('AB1234');
    expect(seats.props.defaultValue).toBe('4');

    await fireEvent.changeText(plate, 'CD-5678');
    await fireEvent.changeText(seats, '3');

    for (const field of [plate, seats]) {
      expect(field.props.value).toBeUndefined();
    }
    expect(plate.props.defaultValue).toBe('AB1234');
    expect(seats.props.defaultValue).toBe('4');

    await fireEvent.press(
      screen.getByRole('button', { name: t('driver.action.save') }),
    );
    await waitFor(() =>
      expect(mockUpdateVehicle).toHaveBeenCalledWith(
        'v9',
        expect.objectContaining({
          plate: 'CD-5678',
          model: 'Superb',
          passengerSeats: 3,
        }),
      ),
    );
  });

  it('shows plate_taken on the plate field (edge)', async () => {
    mockCreateVehicle.mockRejectedValue(new ApiError(409, 'plate_taken'));
    await render(<VehicleScreen />);

    await fill();
    await fireEvent.press(
      screen.getByRole('button', { name: t('driver.action.save') }),
    );

    await screen.findByText(t('driver.error.plate_taken'));
    expect(replace).not.toHaveBeenCalled();
  });

  it('blocks a year outside the schema before any request (failure)', async () => {
    await render(<VehicleScreen />);

    await fill({ year: '1980' });
    await fireEvent.press(
      screen.getByRole('button', { name: t('driver.action.save') }),
    );

    expect(screen.getByText(t('driver.error.invalid_field'))).toBeTruthy();
    expect(mockCreateVehicle).not.toHaveBeenCalled();
  });
});
