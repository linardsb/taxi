import { render, waitFor } from '@testing-library/react-native';
import { SessionGuard } from './session-guard';

const mockState = {
  status: 'signedIn' as 'loading' | 'signedIn' | 'signedOut',
  session: null,
};
jest.mock('./use-session', () => ({
  useSession: () => ({ state: mockState }),
}));

const router = jest.requireMock<typeof import('expo-router')>('expo-router');
const { replace } = router.useRouter();

const onRoute = (...segments: string[]) =>
  (router.useSegments as unknown as jest.Mock).mockReturnValue(segments);

describe('SessionGuard', () => {
  beforeEach(() => {
    (replace as jest.Mock).mockReset();
    mockState.status = 'signedIn';
    onRoute('book');
  });

  it('bounces a signed-out rider off an authed route, with the reason (expected — H3)', async () => {
    mockState.status = 'signedOut';
    onRoute('book', 'status');

    await render(<SessionGuard />);

    // `signOut()` changes state and NOTHING else — `GateScreen` lives at `/`,
    // which its own redirect has already replaced off the stack, and
    // `/book/status` has no guard of its own. Without this the rider taps Book
    // against a dead session and every failure reads `rider.error.generic`.
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({
        pathname: '/login',
        params: { reason: 'session_expired' },
      }),
    );
  });

  it('leaves a signed-in rider where they are (expected)', async () => {
    await render(<SessionGuard />);
    expect(replace).not.toHaveBeenCalled();
  });

  it('does not bounce off /login or /verify — or race the index gate (edge)', async () => {
    mockState.status = 'signedOut';

    for (const route of [['login'], ['verify'], []]) {
      (replace as jest.Mock).mockReset();
      onRoute(...route);
      await render(<SessionGuard />);
      expect(replace).not.toHaveBeenCalled();
    }
  });

  it('stays put while the session is still loading (failure)', async () => {
    mockState.status = 'loading';
    onRoute('book');

    await render(<SessionGuard />);

    // `readSession()` has not answered yet. Redirecting here would throw every
    // returning rider onto /login for the length of one AsyncStorage read.
    expect(replace).not.toHaveBeenCalled();
  });
});
