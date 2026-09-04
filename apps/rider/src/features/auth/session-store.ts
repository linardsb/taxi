import { authSessionSchema, type AuthSession } from '@taxi/shared';
import * as SecureStore from 'expo-secure-store';

/** One JSON blob: token + expiry + user ≈ 600 bytes, under SecureStore's iOS ceiling. */
export const SESSION_KEY = 'sakta.rider.session';

/**
 * The stored session, or null — and the store is CLEANED on any miss, so a
 * corrupt or expired blob cannot bounce every launch. Expiry is checked
 * here as UX; the api's 401 and the gateway's token sweep are the
 * enforcement (the console's `loadSession` rule).
 */
export async function readSession(
  nowMs: number = Date.now(),
): Promise<AuthSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await clearSession();
    return null;
  }
  const result = authSessionSchema.safeParse(parsed);
  if (!result.success || Date.parse(result.data.expiresAt) <= nowMs) {
    await clearSession();
    return null;
  }
  return result.data;
}

export async function writeSession(session: AuthSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}
