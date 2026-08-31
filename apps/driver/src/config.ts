/**
 * The API origin the phone talks to — REST and the socket handshake alike.
 * `EXPO_PUBLIC_*` is inlined by Metro at BUNDLE time, so a build carries the
 * origin it was bundled with (the env template documents the emulator's
 * `10.0.2.2` alias). Not a turbo `globalEnv`: no turbo task reads it.
 */
export const apiUrl = (): string =>
  process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';
