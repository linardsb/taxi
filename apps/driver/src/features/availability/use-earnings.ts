import {
  driverEarningsTodaySchema,
  type DriverEarningsToday,
} from '@taxi/shared';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useSession } from '@/features/auth';

/** How often the card refreshes while online — the api read is one indexed aggregate. */
export const EARNINGS_REFRESH_MS = 60_000;

export type EarningsStatus = 'loading' | 'ready' | 'error';

/**
 * `GET /drivers/me/earnings/today`: on mount, on every foreground, and every
 * minute while online. Keeps the last good value across an error so the
 * card degrades to stale rather than blank.
 */
export function useEarnings(online: boolean): {
  earnings: DriverEarningsToday | null;
  status: EarningsStatus;
  refresh: () => void;
} {
  const { api } = useSession();
  const [earnings, setEarnings] = useState<DriverEarningsToday | null>(null);
  const [status, setStatus] = useState<EarningsStatus>('loading');

  const refresh = useCallback(() => {
    void api
      .request('GET', '/drivers/me/earnings/today', {
        schema: driverEarningsTodaySchema,
      })
      .then((next) => {
        setEarnings(next);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  }, [api]);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  useEffect(() => {
    if (!online) return;
    const timer = setInterval(refresh, EARNINGS_REFRESH_MS);
    return () => clearInterval(timer);
  }, [online, refresh]);

  return { earnings, status, refresh };
}
