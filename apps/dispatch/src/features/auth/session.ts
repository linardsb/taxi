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

/**
 * The board's last-frame cache — declared HERE, next to the session key,
 * because `clearSession()` must remove it and the auth slice must not import
 * the board slice (board → auth already exists; the reverse closes a cycle).
 * The board slice imports this constant back.
 */
export const BOARD_SNAPSHOT_STORAGE_KEY = 'taxi.console.board-snapshot';

/**
 * The phone-order draft (#19) — declared here for the same reason as the board
 * snapshot above, and with a stronger PII claim: it holds the CALLER's phone
 * number, their name and both addresses, typed by hand and persisted on every
 * keystroke. A draft left on a shared operator workstation after logout is
 * exactly the leak `clearSession()` exists to prevent.
 */
export const BOOKING_DRAFT_STORAGE_KEY = 'taxi.console.booking-draft';

/** Who may see the console at all — `/admin` narrows further to admin. */
export const CONSOLE_ROLES: readonly UserRole[] = ['dispatcher', 'admin'];

export function saveSession(session: AuthSession): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

/**
 * Ends the session AND drops everything cached under it. The board snapshot
 * is written on every frame and carries every online driver's name, phone and
 * last position plus every live ride's pickup address — third-party PII that
 * must not outlive the session on a shared operator workstation. The accepted
 * XSS risk documented above covers exposure of the TOKEN, not a PII cache
 * left on disk with no session present.
 */
export function clearSession(): void {
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(BOARD_SNAPSHOT_STORAGE_KEY);
  window.localStorage.removeItem(BOOKING_DRAFT_STORAGE_KEY);
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
