import { apiUrl } from './config';

/** RN declares `__DEV__` as a bare global; jest-expo sets it true. */
const flags = globalThis as unknown as { __DEV__: boolean };

describe('apiUrl', () => {
  const original = process.env.EXPO_PUBLIC_API_URL;
  const dev = flags.__DEV__;
  afterEach(() => {
    if (original === undefined) delete process.env.EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = original;
    flags.__DEV__ = dev;
  });

  it('returns the origin the build was bundled with (expected)', () => {
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.lv';
    expect(apiUrl()).toBe('https://api.example.lv');
  });

  it('falls back to localhost in a dev build only (edge)', () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    flags.__DEV__ = true;
    expect(apiUrl()).toBe('http://localhost:3001');
  });

  it('a release build with no origin throws by name instead of targeting the phone itself (failure)', () => {
    delete process.env.EXPO_PUBLIC_API_URL;
    flags.__DEV__ = false;
    expect(() => apiUrl()).toThrow('EXPO_PUBLIC_API_URL');
  });
});
