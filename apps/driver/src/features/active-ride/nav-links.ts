import type { LatLng } from '@taxi/shared';
import { Linking, Platform } from 'react-native';

/**
 * Deep-link out, never build (evidence §5.4). Google Maps gets the platform's
 * own scheme with the universal URL as the fallback; Waze has one scheme and
 * is offered only when `canOpenURL` says it is installed (iOS needs the
 * schemes in `LSApplicationQueriesSchemes`, `app.json`).
 */
export interface NavLink {
  url: string;
  fallback: string;
}

export function googleMapsLink(
  target: LatLng,
  os: typeof Platform.OS = Platform.OS,
): NavLink {
  const fallback = `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving`;
  if (os === 'android') {
    return {
      url: `google.navigation:q=${target.lat},${target.lng}&mode=d`,
      fallback,
    };
  }
  if (os === 'ios') {
    return {
      url: `comgooglemaps://?daddr=${target.lat},${target.lng}&directionsmode=driving`,
      fallback,
    };
  }
  return { url: fallback, fallback };
}

export function wazeLink(target: LatLng): NavLink {
  const url = `waze://?ll=${target.lat},${target.lng}&navigate=yes`;
  return {
    url,
    fallback: `https://waze.com/ul?ll=${target.lat},${target.lng}&navigate=yes`,
  };
}

/** Opens the app scheme; if the OS refuses (not installed), the web fallback. Never throws. */
export async function openNavigation(link: NavLink): Promise<void> {
  try {
    await Linking.openURL(link.url);
  } catch {
    await Linking.openURL(link.fallback).catch(() => undefined);
  }
}

/** Whether the Waze button should exist at all on this phone. */
export function canOpenWaze(target: LatLng): Promise<boolean> {
  return Linking.canOpenURL(wazeLink(target).url).catch(() => false);
}
