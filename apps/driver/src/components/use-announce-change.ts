import { useEffect, useRef } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Speaks `text` with `announceForAccessibility` when it changes to a
 * non-empty value, on both platforms. Not on mount (a live region would not
 * speak its initial content either), and not while `enabled` is false — a
 * change made then is dropped, not replayed later.
 *
 * The replacement for `accessibilityLiveRegion`, which does not reach
 * TalkBack on this stack: #259 R11 (`sakta224`, API 36, RN 0.86.3) saw a live
 * region change with `nodeLiveRegion=0` and 0 utterances, where
 * `announceForAccessibility` spoke the same text (#279).
 */
export function useAnnounceChange(
  text: string | null | undefined,
  enabled = true,
) {
  const last = useRef(text);
  useEffect(() => {
    if (text === last.current) return;
    last.current = text;
    if (!text || !enabled) return;
    AccessibilityInfo.announceForAccessibility(text);
  }, [text, enabled]);
}
