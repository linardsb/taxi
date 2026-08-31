import * as IntentLauncher from 'expo-intent-launcher';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { T } from '@/features/i18n';
import { LOCATION_TASK, locationTaskOptions } from './location-options';

export type PermissionResult =
  'granted' | 'foreground_denied' | 'background_denied';

/**
 * Foreground first, then background, in that order — Android 11+ opens the
 * system Settings page for the second and returns when the driver comes
 * back, so the answer is re-read rather than trusted.
 */
export async function ensureLocationPermissions(): Promise<PermissionResult> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'foreground_denied';
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status === 'granted') return 'granted';
  const again = await Location.getBackgroundPermissionsAsync();
  return again.status === 'granted' ? 'granted' : 'background_denied';
}

/**
 * Starts the background task — ONLY while foregrounded (the toggle is on
 * screen when this runs; Android 12+ refuses a foreground service started
 * from the background). Idempotent.
 */
export async function startStreaming(t: T): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) return;
  await Location.startLocationUpdatesAsync(
    LOCATION_TASK,
    locationTaskOptions(t),
  );
}

export async function stopStreaming(): Promise<void> {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}

/** True when Android kept the service alive across a process kill (D14). */
export function isStreaming(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
}

const BATTERY_PROMPT_KEY = 'sakta.driver.battery_prompt_shown';

/** Android only, once (D17): the explainer is skippable and never repeats. */
export async function batteryPromptDue(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  return (await SecureStore.getItemAsync(BATTERY_PROMPT_KEY)) === null;
}

export async function markBatteryPromptShown(): Promise<void> {
  await SecureStore.setItemAsync(BATTERY_PROMPT_KEY, new Date().toISOString());
}

/** The settings list, no special permission — not `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`. */
export async function openBatteryOptimisationSettings(): Promise<void> {
  await IntentLauncher.startActivityAsync(
    IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS,
  );
}
