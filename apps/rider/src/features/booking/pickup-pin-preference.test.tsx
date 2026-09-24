import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';
import {
  PICKUP_PIN_KEY,
  usePickupPinPreference,
} from './pickup-pin-preference';

const getItem = AsyncStorage.getItem as jest.Mock;
const setItem = AsyncStorage.setItem as jest.Mock;

describe('usePickupPinPreference (#258)', () => {
  afterEach(async () => {
    await AsyncStorage.removeItem(PICKUP_PIN_KEY);
    jest.clearAllMocks();
  });

  it('starts unloaded, then reads the stored value (expected)', async () => {
    let resolve!: (v: string | null) => void;
    getItem.mockImplementationOnce(
      () => new Promise<string | null>((r) => (resolve = r)),
    );
    const { result } = await renderHook(() => usePickupPinPreference());

    expect(result.current).toMatchObject({ value: false, loaded: false });
    await act(async () => resolve('1'));
    expect(result.current).toMatchObject({ value: true, loaded: true });
  });

  it('treats a storage failure as off, and loaded (failure)', async () => {
    getItem.mockImplementationOnce(() => Promise.reject(new Error('io')));
    const { result } = await renderHook(() => usePickupPinPreference());

    await act(async () => {});
    expect(result.current).toMatchObject({ value: false, loaded: true });
  });

  it("writes '1' when switched on (expected)", async () => {
    const { result } = await renderHook(() => usePickupPinPreference());
    await act(async () => {});

    await act(async () => result.current.set(true));

    expect(result.current.value).toBe(true);
    expect(setItem).toHaveBeenCalledWith(PICKUP_PIN_KEY, '1');
  });

  it('keeps the switched value when the write fails (edge)', async () => {
    const { result } = await renderHook(() => usePickupPinPreference());
    await act(async () => {});
    setItem.mockImplementationOnce(() => Promise.reject(new Error('full')));

    await act(async () => result.current.set(true));

    expect(result.current.value).toBe(true);
  });

  it('does not update state after an unmount mid-read (edge)', async () => {
    let resolve!: (v: string | null) => void;
    getItem.mockImplementationOnce(
      () => new Promise<string | null>((r) => (resolve = r)),
    );
    const error = jest.spyOn(console, 'error').mockImplementation();
    const { unmount } = await renderHook(() => usePickupPinPreference());

    await unmount();
    await act(async () => resolve('1'));

    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
