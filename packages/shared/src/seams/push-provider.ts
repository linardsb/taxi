/**
 * Seam over Expo's push service (#14) so the "you've gone offline" nudge —
 * and #15's offer pushes after it — can move to FCM/APNs direct post-pilot
 * without touching the drivers slice. Types only: this file is imported by
 * React Native, so no Node globals and no SDK.
 */

export interface PushMessage {
  title: string;
  body: string;
  /** Opaque routing hints for the app (`{ kind: 'offline_nudge' }`). Strings only — Expo forwards them verbatim. */
  data?: Record<string, string>;
}

/**
 * The Android notification channel every push this platform sends lands on —
 * `channelId` on the api's Expo request, and the channel BOTH apps create at
 * registration. One literal because it is a three-surface contract (api,
 * `apps/driver`, `apps/rider`), and drift between them is silent: Android
 * routes a push naming an unknown channel into the default channel at default
 * importance, so an arrival alarm degrades into a quiet tray line with nothing
 * failing anywhere.
 */
export const PUSH_CHANNEL_ID = 'presence';

/**
 * EXACTLY TWO, split by the one question the caller must answer — SHOULD THE
 * TOKEN BE FORGOTTEN?
 *
 * - `device_not_registered` — YES: the provider says this token will never
 *   deliver again (app uninstalled, token rotated). The caller nulls it.
 * - `provider_error` — NO: everything transient and EVERYTHING UNRECOGNISED.
 *   The nudge is best-effort, so the caller's move is "log and move on".
 *
 * `tests/push-provider.test.ts` pins the set so a third value has to earn a
 * third caller behaviour deliberately.
 */
export const PUSH_DELIVERY_FAILURES = [
  'device_not_registered',
  'provider_error',
] as const;
export type PushDeliveryFailure = (typeof PUSH_DELIVERY_FAILURES)[number];

/** A result union, never a thrown error — a dead token is an expected outcome of a correct call. */
export type PushDeliveryResult =
  { ok: true } | { ok: false; reason: PushDeliveryFailure };

export interface PushProvider {
  /**
   * Never throws — a nudge is best-effort; the caller reads `reason`.
   * `device_not_registered` = forget the token.
   */
  send(token: string, message: PushMessage): Promise<PushDeliveryResult>;
}
