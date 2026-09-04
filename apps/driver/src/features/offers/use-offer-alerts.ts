import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useRef } from 'react';

const OFFER_TONE = require('../../../assets/sounds/offer-tone.wav') as number;

/** The final seconds that each get a heavy tap — evidence §5.3's "redundant channels". */
export const HAPTIC_COUNTDOWN_FROM_S = 5;

export interface OfferAlerts {
  /** Tone on loop + one warning buzz — the card just arrived. */
  start(): void;
  /** Silence, rewound for the next card. */
  stop(): void;
}

/**
 * Sound + haptic for the offer card (#15). The tone is a 1 s looped asset
 * (150 ms 880 Hz beep + silence, `scripts/make-offer-tone.mjs`); it plays
 * through the silent switch, because a muted phone on a dashboard is the
 * normal case. `remainingMs` drives one heavy impact per second for the last
 * `HAPTIC_COUNTDOWN_FROM_S` seconds, only while the tone is running.
 *
 * Every native call is best-effort: a haptics or audio failure must never
 * reach the reducer or the card.
 */
export function useOfferAlerts(remainingMs: number): OfferAlerts {
  const player = useAudioPlayer(OFFER_TONE);
  const running = useRef(false);
  const lastBuzzedSecond = useRef<number | null>(null);

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
  }, []);

  // The compiler rule reads `player` as a frozen hook result; expo-audio's
  // player is a native handle whose `loop`/`play`/`pause` ARE its contract.
  /* eslint-disable react-hooks/immutability */
  const start = useCallback(() => {
    running.current = true;
    lastBuzzedSecond.current = null;
    try {
      player.loop = true;
      player.play();
    } catch {
      // no audio session (simulator without output, permissions) — the card still shows
    }
    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Warning,
    ).catch(() => undefined);
  }, [player]);

  const stop = useCallback(() => {
    running.current = false;
    try {
      player.pause();
      void player.seekTo(0);
    } catch {
      // as above
    }
  }, [player]);
  /* eslint-enable react-hooks/immutability */

  useEffect(() => {
    if (!running.current) return;
    const seconds = Math.ceil(remainingMs / 1000);
    if (seconds > HAPTIC_COUNTDOWN_FROM_S || seconds <= 0) return;
    if (lastBuzzedSecond.current === seconds) return;
    lastBuzzedSecond.current = seconds;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(
      () => undefined,
    );
  }, [remainingMs]);

  // Unmount = provider gone = app gone; still, leave nothing looping.
  useEffect(() => () => stop(), [stop]);

  return { start, stop };
}
