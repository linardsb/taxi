import { Injectable, Logger } from '@nestjs/common';
import type { TelephonyProvider } from '@taxi/shared';

/**
 * The pilot's telephony binding: Dina reads the number off her handset and
 * types it. `dial()` records the intent and resolves; `currentCaller()` reports
 * no active call, which is the truthful answer from a gateway that does not
 * exist.
 *
 * Resolving rather than throwing is deliberate. A throwing `dial()` would make
 * the console render a failed action for a feature nobody has bought yet; a
 * resolved no-op keeps the click-to-dial affordance's `tel:` fallback as the
 * only path the dispatcher ever sees.
 */
@Injectable()
export class StubTelephonyProvider implements TelephonyProvider {
  private readonly logger = new Logger(StubTelephonyProvider.name);

  dial(phoneE164: string): Promise<void> {
    // No `phone` field: `.claude/references/logging-standard.md` keeps caller
    // identifiers out of the line. The length is enough to tell a mis-wired
    // client from a real number without recording whose number it was.
    this.logger.log({
      event: 'telephony.dial.stubbed',
      phoneLength: phoneE164.length,
      at: new Date().toISOString(),
    });
    return Promise.resolve();
  }

  currentCaller(): Promise<string | null> {
    return Promise.resolve(null);
  }
}
