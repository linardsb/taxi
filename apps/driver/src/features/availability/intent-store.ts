import * as SecureStore from 'expo-secure-store';

export type Intent = 'online' | 'offline';

/** What the DRIVER wants — survives a kill so a cold launch knows whether to recover. */
const INTENT_KEY = 'sakta.driver.intent';
/** When the app learned the server flipped it — the banner's «HH:MM». */
const MARKED_OFFLINE_KEY = 'sakta.driver.marked_offline_at';

export async function readIntent(): Promise<Intent> {
  return (await SecureStore.getItemAsync(INTENT_KEY)) === 'online'
    ? 'online'
    : 'offline';
}

export async function writeIntent(intent: Intent): Promise<void> {
  await SecureStore.setItemAsync(INTENT_KEY, intent);
}

export async function readMarkedOfflineAt(): Promise<string | null> {
  return SecureStore.getItemAsync(MARKED_OFFLINE_KEY);
}

export async function writeMarkedOfflineAt(at: string | null): Promise<void> {
  if (at === null) await SecureStore.deleteItemAsync(MARKED_OFFLINE_KEY);
  else await SecureStore.setItemAsync(MARKED_OFFLINE_KEY, at);
}
