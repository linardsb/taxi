/**
 * The API origin the phone talks to — REST and the socket handshake alike.
 * `EXPO_PUBLIC_*` is inlined by Metro at BUNDLE time, so a build carries the
 * origin it was bundled with (the env template documents the emulator's
 * `10.0.2.2` alias). Not a turbo `globalEnv`: no turbo task reads it.
 *
 * The localhost fallback is DEV ONLY. A release build bundled without the
 * variable used to target `http://localhost:3001` on a phone that IS the
 * phone — every request read as `offline`, indistinguishable from an outage.
 * It throws instead, at the first call, with the variable's name.
 */
export const apiUrl = (): string => {
  const url = process.env.EXPO_PUBLIC_API_URL;
  if (url) return url;
  if (__DEV__) return 'http://localhost:3001';
  throw new Error(
    'EXPO_PUBLIC_API_URL is not set — a release build must be bundled with the api origin',
  );
};
