import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';
import {
  ANNOUNCE_ARRIVAL_KEY,
  PICKUP_PIN_KEY,
  useAnnounceArrivalPreference,
  usePickupPinPreference,
} from './pickup-pin-preference';

const getItem = AsyncStorage.getItem as jest.Mock;
const setItem = AsyncStorage.setItem as jest.Mock;

describe('useAnnounceArrivalPreference (#259)', () => {
  afterEach(async () => {
    await AsyncStorage.removeItem(ANNOUNCE_ARRIVAL_KEY);
    jest.clearAllMocks();
  });

  it('starts unloaded, then reads the stored value (expected)', async () => {
    let resolve!: (v: string | null) => void;
    getItem.mockImplementationOnce(
      () => new Promise<string | null>((r) => (resolve = r)),
    );
    const { result } = await renderHook(() => useAnnounceArrivalPreference());

    expect(result.current).toMatchObject({ value: false, loaded: false });
    await act(async () => resolve('1'));
    expect(result.current).toMatchObject({ value: true, loaded: true });
  });

  it('treats a storage failure as off, and loaded (failure)', async () => {
    getItem.mockImplementationOnce(() => Promise.reject(new Error('io')));
    const { result } = await renderHook(() => useAnnounceArrivalPreference());

    await act(async () => {});
    expect(result.current).toMatchObject({ value: false, loaded: true });
  });

  it("writes '1' when switched on (expected)", async () => {
    const { result } = await renderHook(() => useAnnounceArrivalPreference());
    await act(async () => {});

    await act(async () => result.current.set(true));

    expect(result.current.value).toBe(true);
    expect(setItem).toHaveBeenCalledWith(ANNOUNCE_ARRIVAL_KEY, '1');
  });

  it('keeps the switched value when the write fails (edge)', async () => {
    const { result } = await renderHook(() => useAnnounceArrivalPreference());
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
    const { unmount } = await renderHook(() => useAnnounceArrivalPreference());

    await unmount();
    await act(async () => resolve('1'));

    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('the two booking preferences (#259)', () => {
  afterEach(() => jest.clearAllMocks());

  it('are stored under separate keys, so one never flips the other (edge)', async () => {
    const { result } = await renderHook(() => ({
      pin: usePickupPinPreference(),
      announce: useAnnounceArrivalPreference(),
    }));
    await act(async () => {});

    await act(async () => result.current.announce.set(true));

    expect(result.current.announce.value).toBe(true);
    expect(result.current.pin.value).toBe(false);
    expect(setItem).toHaveBeenCalledWith(ANNOUNCE_ARRIVAL_KEY, '1');
    expect(setItem).not.toHaveBeenCalledWith(PICKUP_PIN_KEY, expect.anything());
  });
});
