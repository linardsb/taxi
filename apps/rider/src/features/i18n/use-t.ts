import { formatMessage, type Language, type MessageKey } from '@taxi/shared';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { deviceLanguage } from './device-language';

export type Params = Readonly<Record<string, string | number>>;
export type T = (key: MessageKey, params?: Params) => string;

/**
 * The device language, re-read whenever the app comes to the foreground —
 * Android changes locale without restarting the app.
 */
export function useLanguage(): Language {
  const [lang, setLang] = useState<Language>(() => deviceLanguage());
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setLang(deviceLanguage());
    });
    return () => sub.remove();
  }, []);
  return lang;
}

/** `const t = useT(); t('rider.book.confirm')` — the catalog, bound to the device language. */
export function useT(): T {
  const lang = useLanguage();
  return useCallback<T>(
    (key, params) => formatMessage(lang, key, params),
    [lang],
  );
}
