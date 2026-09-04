import type { AuthSession } from '@taxi/shared';
import * as SecureStore from 'expo-secure-store';
import { readSession, SESSION_KEY, writeSession } from './session-store';

const session = (expiresAt: string): AuthSession => ({
  accessToken: 'token',
  expiresAt,
  user: {
    id: '8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f',
    phone: '+37126123456',
    role: 'rider',
    language: 'lv',
    createdAt: '2026-08-01T00:00:00.000Z',
  },
});

describe('session store', () => {
  beforeEach(async () => {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  });

  it('round-trips a session through SecureStore (expected)', async () => {
    const s = session('2099-01-01T00:00:00.000Z');
    await writeSession(s);

    expect(await readSession()).toEqual(s);
  });

  it('treats an expired session as signed out and clears it (edge)', async () => {
    await writeSession(session('2020-01-01T00:00:00.000Z'));

    expect(await readSession()).toBeNull();
    expect(await SecureStore.getItemAsync(SESSION_KEY)).toBeNull();
  });

  it('survives corrupt JSON without throwing, and cleans it (failure)', async () => {
    await SecureStore.setItemAsync(SESSION_KEY, '{not json');

    await expect(readSession()).resolves.toBeNull();
    expect(await SecureStore.getItemAsync(SESSION_KEY)).toBeNull();
  });
});
