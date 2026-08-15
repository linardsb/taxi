import {
  authSessionSchema,
  type AuthSession,
  type UserRole,
} from '@taxi/shared';

/**
 * Token + user persistence for the console (pure module — cheap to test).
 *
 * localStorage, not an httpOnly cookie, deliberately: the socket handshake
 * needs the raw token client-side (`handshake.auth.token`) and the API has no
 * cookie support. XSS exposure is accepted for an internal operator console —
 * enforcement is server-side (`@Roles` + the gateway's token sweep); this
 * module and the client guard are UX only.
 */
export const SESSION_STORAGE_KEY = 'taxi.console.session';
const STORAGE_KEY = SESSION_STORAGE_KEY;

/** Who may see the console at all — `/admin` narrows further to admin. */
export const CONSOLE_ROLES: readonly UserRole[] = ['dispatcher', 'admin'];

export function saveSession(session: AuthSession): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

/**
 * The stored session, or null — and the store is CLEANED on any miss, so a
 * corrupt or expired blob can't bounce every load. Expiry is checked here
 * (client clock) as UX; the server sweep disconnects a stale token's socket
 * within 60 s regardless of what this returns.
 */
export function loadSession(nowMs: number = Date.now()): AuthSession | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearSession();
    return null;
  }
  const result = authSessionSchema.safeParse(parsed);
  if (!result.success || Date.parse(result.data.expiresAt) <= nowMs) {
    clearSession();
    return null;
  }
  return result.data;
}

export function hasConsoleRole(session: AuthSession): boolean {
  return CONSOLE_ROLES.includes(session.user.role);
}
