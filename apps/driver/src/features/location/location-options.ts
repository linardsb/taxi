import { colors } from '@taxi/shared';
import * as Location from 'expo-location';
import type { T } from '@/features/i18n';

export const LOCATION_TASK = 'sakta-driver-location';

/**
 * The #4 harness's options, ported — with ONE deviation (D7):
 * `distanceInterval: 0` instead of the harness's `10`. A parked driver then
 * keeps producing fixes (iOS: continuous under BestForNavigation; Android:
 * `timeInterval` regardless of movement), so the fix stream IS the
 * heartbeat dark detection reads, and no background timer — which iOS would
 * not run — is needed. The client throttle (`fix-throttle.ts`) keeps the
 * wire cadence at the harness's moving cadence.
 */
export function locationTaskOptions(t: T): Location.LocationTaskOptions {
  return {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 4000, // Android-only floor; the throttle is the cross-platform one
    distanceInterval: 0, // D7 — the harness had 10
    deferredUpdatesInterval: 0, // deliver immediately, do not batch
    deferredUpdatesDistance: 0,
    activityType: Location.ActivityType.AutomotiveNavigation,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: t('driver.foreground_service.title'),
      notificationBody: t('driver.foreground_service.body'),
      notificationColor: colors.accent,
      killServiceOnDestroy: false,
    },
  };
}
