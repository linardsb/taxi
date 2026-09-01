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
