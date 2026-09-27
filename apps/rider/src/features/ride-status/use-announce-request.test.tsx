import { act, renderHook } from '@testing-library/react-native';
import { ApiError } from '@/features/auth';
import { useAnnounceRequest } from './use-announce-request';

const mockRequest = jest.fn();
const mockSessionContext = { api: { request: mockRequest } };
jest.mock('@/features/auth', () => ({
  ...jest.requireActual<typeof import('@/features/auth')>('@/features/auth'),
  useSession: () => mockSessionContext,
}));

const RIDE_ID = '2f1b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';

describe('useAnnounceRequest (#259)', () => {
  beforeEach(() => mockRequest.mockReset());

  it('POSTs the request and tags the result with the status it was sent at (expected)', async () => {
    mockRequest.mockResolvedValue({ ok: true });
    const { result } = await renderHook(() => useAnnounceRequest(RIDE_ID));

    await act(async () => result.current.send('arrived'));

    expect(mockRequest).toHaveBeenCalledWith(
      'POST',
      `/rides/${RIDE_ID}/announce-request`,
    );
    expect(result.current.result).toEqual({
      forStatus: 'arrived',
      value: 'sent',
    });
    expect(result.current.busy).toBe(false);
  });

  it('clears the last result while the next is in flight (edge — H3)', async () => {
    mockRequest.mockResolvedValueOnce({ ok: true });
    const { result } = await renderHook(() => useAnnounceRequest(RIDE_ID));
    await act(async () => result.current.send('arrived'));

    let settle!: (v: unknown) => void;
    mockRequest.mockReturnValueOnce(new Promise((r) => (settle = r)));
    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.send('arrived');
    });

    expect(result.current.result).toBeNull();
    expect(result.current.busy).toBe(true);
    await act(async () => {
      settle({ ok: true });
      await pending;
    });
    expect(result.current.result?.value).toBe('sent');
  });

  it('ignores a press while one is in flight (edge)', async () => {
    let settle!: (v: unknown) => void;
    mockRequest.mockReturnValueOnce(new Promise((r) => (settle = r)));
    const { result } = await renderHook(() => useAnnounceRequest(RIDE_ID));

    let first!: Promise<void>;
    await act(async () => {
      first = result.current.send('arrived');
    });
    await act(async () => result.current.send('arrived'));
    await act(async () => {
      settle({ ok: true });
      await first;
    });

    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('maps a refusal to its catalog key, and an unknown code to generic (failure)', async () => {
    mockRequest.mockRejectedValueOnce(new ApiError(409, 'ride_not_arrived'));
    const { result } = await renderHook(() => useAnnounceRequest(RIDE_ID));

    await act(async () => result.current.send('arrived'));
    expect(result.current.result?.value).toBe('rider.error.ride_not_arrived');

    mockRequest.mockRejectedValueOnce(new Error('boom'));
    await act(async () => result.current.send('arrived'));
    expect(result.current.result?.value).toBe('rider.error.generic');
  });
});
