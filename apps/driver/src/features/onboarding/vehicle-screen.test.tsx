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
      category: 'standard',
    });
  });

  it('editing keeps the stored category and strips plate whitespace — an admin-set tier survives a plate correction (edge)', async () => {
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
        expect.objectContaining({ plate: 'AB1234', category: 'limo' }),
      ),
    );
    expect(mockCreateVehicle).not.toHaveBeenCalled();
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
