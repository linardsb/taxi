import type { AuthSession, UserRole } from '@taxi/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearSession,
  hasConsoleRole,
  loadSession,
  saveSession,
} from './session';

const NOW = Date.parse('2026-08-15T12:00:00.000Z');

const session = (over: { role?: UserRole; expiresAt?: string } = {}): AuthSession => ({
  accessToken: 'token-abc',
  expiresAt: over.expiresAt ?? '2026-09-14T12:00:00.000Z',
  user: {
    id: '99999999-8888-4777-8666-555555555555',
    phone: '+37129999001',
    role: over.role ?? 'dispatcher',
    language: 'lv',
    createdAt: '2026-08-01T00:00:00.000Z',
  },
});

afterEach(() => {
  window.localStorage.clear();
});

describe('session persistence', () => {
  it('round-trips a saved session (expected)', () => {
    saveSession(session());

    const loaded = loadSession(NOW);
    expect(loaded?.accessToken).toBe('token-abc');
    expect(loaded?.user.role).toBe('dispatcher');
  });

  it('treats an expired session as absent and cleans the store (edge)', () => {
    saveSession(session({ expiresAt: '2026-08-15T11:59:00.000Z' }));

    expect(loadSession(NOW)).toBeNull();
    expect(window.localStorage.getItem('taxi.console.session')).toBeNull();
  });

  it('survives a corrupt blob — null, cleaned, no throw (failure)', () => {
    window.localStorage.setItem('taxi.console.session', '{not json');

    expect(loadSession(NOW)).toBeNull();
    expect(window.localStorage.getItem('taxi.console.session')).toBeNull();
  });

  it('clearSession removes the stored session (expected)', () => {
    saveSession(session());
    clearSession();
    expect(loadSession(NOW)).toBeNull();
  });

  it('grants the console to dispatcher and admin, refuses rider and driver (edge)', () => {
    expect(hasConsoleRole(session({ role: 'dispatcher' }))).toBe(true);
    expect(hasConsoleRole(session({ role: 'admin' }))).toBe(true);
    expect(hasConsoleRole(session({ role: 'rider' }))).toBe(false);
    expect(hasConsoleRole(session({ role: 'driver' }))).toBe(false);
  });
});
