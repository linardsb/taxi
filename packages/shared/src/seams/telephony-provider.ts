/**
 * Seam over a SIP/VoIP gateway (decided 2026-08-17) — the architecture's named
 * missing piece. NOTHING is bound at pilot: Dina types the caller's number and
 * the console behaves identically. The seam exists so screen-pop automation is
 * a binding change, not a UI rewrite.
 *
 * Unlike the maps seam, an unbound implementation is NOT a production refusal:
 * a stubbed gateway degrades to manual entry, which is the documented day-1
 * plan (#19), not a money bug.
 */
export interface TelephonyProvider {
  /** Places an outbound call from the dispatcher's handset to `phoneE164`.
   *  Throws on gateway failure — the console falls back to a `tel:` link. */
  dial(phoneE164: string): Promise<void>;
  /** The number currently ringing the dispatcher, or null when the gateway
   *  reports no active inbound call. POLLED by the console, not pushed:
   *  a push contract would pin the seam to WebSocket-capable gateways. */
  currentCaller(): Promise<string | null>;
}
