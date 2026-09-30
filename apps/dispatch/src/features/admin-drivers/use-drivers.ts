'use client';

import type {
  AdminDriverDetail,
  AdminDriverSummary,
  AdminDriverUpdate,
  AdminVehicleUpdate,
  DriverApprovalStatus,
  MessageKey,
} from '@taxi/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminAuthExpiredError, adminErrorKey } from '@/features/admin-shell';
import { clearSession } from '@/features/auth';
import * as api from './drivers-api';

export type Outcome = { ok: true } | { ok: false; key: MessageKey };

/**
 * Effects for the two driver screens (#20). Loads run in an effect and write
 * state only in the promise callback — `react-hooks/set-state-in-effect` is an
 * error here — so "loading" is DERIVED (no result for the current request yet)
 * rather than set.
 */

/**
 * The write path both screens share: one write at a time (a double tap would
 * approve twice, or race a save against a delete), and a dead or non-admin
 * session goes to /login rather than to an error the admin cannot act on.
 */
function useRunner(): {
  busy: boolean;
  run: <T>(write: () => Promise<T>, onOk: (value: T) => void) => Promise<Outcome>;
  onLoadError: (error: unknown) => boolean;
} {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  /** True when the error was an auth failure and has been handled. */
  const onLoadError = useCallback(
    (error: unknown) => {
      if (!(error instanceof AdminAuthExpiredError)) return false;
      clearSession();
      router.replace('/login');
      return true;
    },
    [router],
  );

  const run = useCallback(
    async <T,>(write: () => Promise<T>, onOk: (value: T) => void) => {
      if (inFlight.current) return { ok: false, key: 'admin.error.generic' } as const;
      inFlight.current = true;
      setBusy(true);
      try {
        onOk(await write());
        return { ok: true } as const;
      } catch (error) {
        onLoadError(error);
        return { ok: false, key: adminErrorKey(error) } as const;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [onLoadError],
  );

  return { busy, run, onLoadError };
}

type ListResult = {
  filter: DriverApprovalStatus;
  nonce: number;
  drivers: AdminDriverSummary[] | 'error';
};

export function useDriverList(filter: DriverApprovalStatus): {
  drivers: AdminDriverSummary[] | 'loading' | 'error';
  busy: boolean;
  retry: () => void;
  moveTo: (userId: string, to: DriverApprovalStatus) => Promise<Outcome>;
} {
  const { busy, run, onLoadError } = useRunner();
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<ListResult | null>(null);

  useEffect(() => {
    let live = true;
    api.listDrivers(filter).then(
      (drivers) => {
        if (live) setResult({ filter, nonce, drivers });
      },
      (error: unknown) => {
        if (live && !onLoadError(error)) setResult({ filter, nonce, drivers: 'error' });
      },
    );
    return () => {
      live = false;
    };
  }, [filter, nonce, onLoadError]);

  // A refetch after an action keeps showing the list it refreshes; only a new
  // filter, or a retry after an error, shows the loading state.
  const stale =
    result === null ||
    result.filter !== filter ||
    (result.drivers === 'error' && result.nonce !== nonce);

  const moveTo = useCallback(
    (userId: string, to: DriverApprovalStatus) =>
      run(
        () => api.setApproval(userId, to),
        () => {
          // The row no longer matches the filter: drop it now, then refetch
          // so a change made in another tab shows up too.
          setResult((r) =>
            r && r.drivers !== 'error'
              ? { ...r, drivers: r.drivers.filter((d) => d.userId !== userId) }
              : r,
          );
          setNonce((n) => n + 1);
        },
      ),
    [run],
  );

  return {
    drivers: stale ? 'loading' : result.drivers,
    busy,
    retry: () => setNonce((n) => n + 1),
    moveTo,
  };
}

type DetailResult = {
  id: string;
  nonce: number;
  detail: AdminDriverDetail | { error: MessageKey };
};

export function useDriverDetail(id: string): {
  /** A failed load carries its message: a 404 is not a network error. */
  detail: AdminDriverDetail | 'loading' | { error: MessageKey };
  busy: boolean;
  retry: () => void;
  saveProfile: (patch: AdminDriverUpdate) => Promise<Outcome>;
  moveTo: (to: DriverApprovalStatus) => Promise<Outcome>;
  saveVehicle: (vehicleId: string, patch: AdminVehicleUpdate) => Promise<Outcome>;
  removeVehicle: (vehicleId: string) => Promise<Outcome>;
} {
  const { busy, run, onLoadError } = useRunner();
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<DetailResult | null>(null);

  useEffect(() => {
    let live = true;
    api.getDriver(id).then(
      (detail) => {
        if (live) setResult({ id, nonce, detail });
      },
      (error: unknown) => {
        if (live && !onLoadError(error)) {
          setResult({ id, nonce, detail: { error: adminErrorKey(error) } });
        }
      },
    );
    return () => {
      live = false;
    };
  }, [id, nonce, onLoadError]);

  const stale =
    result === null ||
    result.id !== id ||
    ('error' in result.detail && result.nonce !== nonce);

  const replace = useCallback(
    (detail: AdminDriverDetail) => setResult((r) => r && { ...r, detail }),
    [],
  );

  return {
    detail: stale ? 'loading' : result.detail,
    busy,
    retry: () => setNonce((n) => n + 1),
    saveProfile: (patch) => run(() => api.updateDriver(id, patch), replace),
    moveTo: (to) => run(() => api.setApproval(id, to), replace),
    saveVehicle: (vehicleId, patch) =>
      run(
        () => api.updateVehicle(vehicleId, patch),
        (vehicle) =>
          setResult((r) =>
            r && !('error' in r.detail)
              ? {
                  ...r,
                  detail: {
                    ...r.detail,
                    vehicles: r.detail.vehicles.map((v) =>
                      v.id === vehicle.id ? vehicle : v,
                    ),
                  },
                }
              : r,
          ),
      ),
    // Refetched, not patched locally: deleting an online driver's last car
    // takes them offline server-side, and the detail shows that status.
    removeVehicle: (vehicleId) =>
      run(
        () => api.deleteVehicle(vehicleId),
        () => setNonce((n) => n + 1),
      ),
  };
}
