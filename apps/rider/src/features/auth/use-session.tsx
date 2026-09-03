import type { AuthSession } from '@taxi/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { apiUrl } from '@/config';
import { createApiClient, type ApiClient } from './api-client';
import { clearSession, readSession, writeSession } from './session-store';

export type SessionState =
  | { status: 'loading'; session: null }
  | { status: 'signedOut'; session: null }
  | { status: 'signedIn'; session: AuthSession };

export interface SessionContextValue {
  state: SessionState;
  /** The one API client — bearer from the live session, 401 → `signOut`. */
  api: ApiClient;
  signIn(session: AuthSession): Promise<void>;
  signOut(): Promise<void>;
  /**
   * Runs BEFORE the session is cleared, while the token is still valid —
   * availability goes offline and push forgets its token through this.
   * Returns the unsubscribe.
   */
  onBeforeSignOut(fn: () => Promise<void>): () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * What the api client reads at CALL time. Module-level on purpose: the
 * provider is a singleton, the client must not be rebuilt on every session
 * change, and the react-hooks rules forbid both ref reads in render-created
 * closures and mutation of state objects.
 */
const live = {
  session: null as AuthSession | null,
  hooks: new Set<() => Promise<void>>(),
  signOut: (): Promise<void> => Promise.resolve(),
  /**
   * The sign-out in flight. The hooks call the api with the token that just
   * failed on the 401 path, so each 401 re-enters `signOut` — it must join
   * the run in progress, not start another hook pass.
   */
  inFlight: null as Promise<void> | null,
};

export function SessionProvider({
  children,
  api: apiOverride,
}: {
  children: ReactNode;
  /** Tests inject a fake; the app builds the real one. */
  api?: ApiClient;
}) {
  const [state, setState] = useState<SessionState>({
    status: 'loading',
    session: null,
  });
  const api = useMemo(
    () =>
      apiOverride ??
      createApiClient({
        baseUrl: apiUrl(),
        getToken: () => live.session?.accessToken ?? null,
        onUnauthorized: () => void live.signOut(),
      }),
    [apiOverride],
  );

  useEffect(() => {
    let cancelled = false;
    void readSession().then((session) => {
      if (cancelled) return;
      live.session = session;
      setState(
        session
          ? { status: 'signedIn', session }
          : { status: 'signedOut', session: null },
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (session: AuthSession) => {
    await writeSession(session);
    live.session = session;
    setState({ status: 'signedIn', session });
  }, []);

  const signOut = useCallback((): Promise<void> => {
    if (live.session === null) return Promise.resolve();
    // Teardown first, token still valid: the presence layer goes offline
    // and the push token is forgotten server-side. Best effort — a dead
    // network must not keep a driver signed in. Single-flight: see `live`.
    live.inFlight ??= (async () => {
      await Promise.allSettled([...live.hooks].map((fn) => fn()));
      await clearSession();
      live.session = null;
      setState({ status: 'signedOut', session: null });
    })().finally(() => {
      live.inFlight = null;
    });
    return live.inFlight;
  }, []);

  useEffect(() => {
    live.signOut = signOut;
  }, [signOut]);

  const onBeforeSignOut = useCallback((fn: () => Promise<void>) => {
    live.hooks.add(fn);
    return () => {
      live.hooks.delete(fn);
    };
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ state, api, signIn, signOut, onBeforeSignOut }),
    [state, api, signIn, signOut, onBeforeSignOut],
  );
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) {
    throw new Error('useSession must be used inside <SessionProvider>');
  }
  return value;
}
