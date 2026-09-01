import { Injectable, Logger } from '@nestjs/common';
import type {
  PushDeliveryResult,
  PushMessage,
  PushProvider,
} from '@taxi/shared';

/** Last four characters of the token id — enough to correlate a log line with a phone, like `maskPhone`. */
export function maskToken(token: string): string {
  return `…${token.slice(-5)}`;
}

/**
 * Dev implementation of the PushProvider seam (#14). Logs the nudge instead
 * of posting to Expo — the only way to read it during manual validation. The
 * real implementation is `expo-push.provider.ts`, bound by `PUSH_PROVIDER=expo`;
 * the factory refuses this one in production.
 */
@Injectable()
export class StubPushProvider implements PushProvider {
  private readonly logger = new Logger(StubPushProvider.name);

  send(token: string, message: PushMessage): Promise<PushDeliveryResult> {
    this.logger.log({
      event: 'driver.push.stub_sent',
      token: maskToken(token),
      title: message.title,
      body: message.body,
      at: new Date().toISOString(),
    });
    return Promise.resolve({ ok: true });
  }
}
