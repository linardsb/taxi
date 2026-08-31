import { Logger } from '@nestjs/common';
import type {
  PushDeliveryResult,
  PushMessage,
  PushProvider,
} from '@taxi/shared';
import { z } from 'zod';

export const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

/**
 * One ticket per message in the request array. Parsed, never cast: Expo's
 * response is remote JSON, and a cast over a shape change would read a
 * missing `status` as "not ok" and forget a perfectly good token.
 */
const ticketSchema = z.object({
  status: z.enum(['ok', 'error']),
  details: z.object({ error: z.string().optional() }).optional(),
});
const responseSchema = z.object({ data: z.array(ticketSchema).min(1) });

/** Closed enum — Expo's free text never reaches a log line (the `geo.maps.route_failed` rule). */
type ExpoPushFailure =
  'network' | 'unreadable_response' | 'ticket_error' | `http_${number}`;

/**
 * The real PushProvider (#14): ONE `fetch` to Expo's push API, no
 * `expo-server-sdk`. The SDK's chunking, gzip and receipt polling matter at
 * hundreds of messages; the nudge is one message per driver per outage.
 * `fetch` is injectable so the spec drives every branch without a network.
 */
export class ExpoPushProvider implements PushProvider {
  private readonly logger = new Logger(ExpoPushProvider.name);

  constructor(
    private readonly opts: {
      accessToken?: string;
      fetchImpl?: typeof fetch;
      endpoint?: string;
    } = {},
  ) {}

  async send(token: string, message: PushMessage): Promise<PushDeliveryResult> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (this.opts.accessToken) {
      headers.Authorization = `Bearer ${this.opts.accessToken}`;
    }

    let response: Response;
    try {
      response = await fetchImpl(this.opts.endpoint ?? EXPO_PUSH_ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify([
          {
            to: token,
            title: message.title,
            body: message.body,
            data: message.data,
            priority: 'high',
            channelId: 'presence',
            sound: 'default',
          },
        ]),
      });
    } catch {
      return this.fail('network');
    }
    if (!response.ok) return this.fail(`http_${response.status}`);

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return this.fail('unreadable_response');
    }
    const parsed = responseSchema.safeParse(json);
    if (!parsed.success) return this.fail('unreadable_response');

    const ticket = parsed.data.data[0]!;
    if (ticket.status === 'ok') return { ok: true };
    if (ticket.details?.error === 'DeviceNotRegistered') {
      return { ok: false, reason: 'device_not_registered' };
    }
    return this.fail('ticket_error');
  }

  /** Never throws — a nudge is best-effort; the caller reads `reason`. */
  private fail(reason: ExpoPushFailure): PushDeliveryResult {
    this.logger.warn({
      event: 'driver.push.request_failed',
      reason,
      at: new Date().toISOString(),
    });
    return { ok: false, reason: 'provider_error' };
  }
}
