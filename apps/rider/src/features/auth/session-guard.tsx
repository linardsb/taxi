import { useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { useSession } from './use-session';

/**
 * The routes a signed-out rider is allowed to be on. `''` is the index route,
 * whose `GateScreen` does its own redirect — listing it here keeps the two from
 * racing to the same destination.
 */
const PUBLIC_SEGMENTS = ['', 'login', 'verify'];

/**
 * Bounces a signed-out rider off the authed routes, with the reason.
 *
 * WITHOUT THIS, `signOut()` CHANGES STATE AND NOTHING ELSE. `GateScreen` is the
 * only auth-aware surface and it lives at `/`, which its own
 * `<Redirect href="/book" />` has already replaced off the stack; `/book`,
 * `/book/address` and `/book/status` have no guard of their own. The 30-day
 * token expires while the app is backgrounded — `session-store.ts` checks
 * `expiresAt` at launch only — so the first request 401s, `api-client.ts` calls
 * `onUnauthorized`, the session clears, and the rider is left tapping Book
 * against a dead session. Every later request then carries no bearer, so
 * `onUnauthorized` is not even reached (it requires a token) and each failure
 * renders as `rider.error.generic`.
 *
 * Renders NOTHING. It is a sibling of the `<Stack>` rather than a wrapper so
 * that navigating is all it can do — a guard that also decided what to render
 * would be a second `GateScreen`.
 *
 * `reason` is carried so the bounce is explained rather than mysterious:
 * `rider.error.session_expired` was written in all three catalogs for this and
 * had no reference in the app at all.
 */
export function SessionGuard() {
  const { state } = useSession();
  const segments = useSegments();
  const router = useRouter();
  const stranded =
    state.status === 'signedOut' &&
    !PUBLIC_SEGMENTS.includes(segments[0] ?? '');

  useEffect(() => {
    if (!stranded) return;
    router.replace({
      pathname: '/login',
      params: { reason: 'session_expired' },
    });
  }, [router, stranded]);

  return null;
}
