'use client';

import type { AuthSession } from '@taxi/shared';
import { useSyncExternalStore } from 'react';
import { loadSession, SESSION_STORAGE_KEY } from './session';

/**
 * The stored session as React state. Three-valued on purpose:
 * `undefined` = SSR/hydration (localStorage unreachable — the server
 * snapshot), `null` = no valid session, else the session. Guards must not
 * redirect on `undefined` — that would bounce every hard refresh.
 *
 * useSyncExternalStore rather than a mount effect: localStorage IS an
 * external store, this keeps server and client hydration consistent by
 * construction, and a login/logout in another tab propagates via `storage`.
 */

let cached: { raw: string | null; session: AuthSession | null } | null = null;

/**
 * Object.is-stable per stored value — uSES requires a cached snapshot.
 *
 * The cache is keyed on the stored string AND on the cached session still
 * being unexpired. Keyed on the string alone, nothing in the tab ever
 * invalidates it, so `loadSession`'s expiry branch could not fire once warm
 * and the client-side expiry check was inert. Nothing here polls the clock —
 * the snapshot flips on the next render for any reason, which is what a UX
 * check is worth; the API's 401 path and the gateway's 60 s token sweep are
 * the enforcement, unchanged.
 */
function clientSnapshot(): AuthSession | null {
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  const warm =
    cached !== null &&
    cached.raw === raw &&
    (cached.session === null ||
      Date.parse(cached.session.expiresAt) > Date.now());
  if (warm) return cached!.session;
  const session = loadSession();
  // loadSession may have CLEANED an expired/corrupt blob — key the cache off
  // what is stored NOW, so the very next read is a stable hit.
  cached = {
    raw: window.localStorage.getItem(SESSION_STORAGE_KEY),
    session,
  };
  return session;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

export function useSession(): AuthSession | null | undefined {
  return useSyncExternalStore(subscribe, clientSnapshot, () => undefined);
}
