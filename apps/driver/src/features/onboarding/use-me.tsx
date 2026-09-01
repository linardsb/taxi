import {
  driverMeSchema,
  driverProfileSchema,
  vehicleSchema,
  type DriverMe,
  type DriverProfileUpdate,
  type Vehicle,
  type VehicleCreate,
  type VehicleUpdate,
} from '@taxi/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useSession } from '@/features/auth';

export type MeStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface MeContextValue {
  me: DriverMe | null;
  status: MeStatus;
  refetch(): Promise<DriverMe | null>;
  patchProfile(patch: DriverProfileUpdate): Promise<void>;
  createVehicle(vehicle: VehicleCreate): Promise<Vehicle>;
  updateVehicle(id: string, patch: VehicleUpdate): Promise<Vehicle>;
}

const MeContext = createContext<MeContextValue | null>(null);

/**
 * `GET /drivers/me` as React state — the whole bootstrap in one call. No
 * optimism: every write refetches, so the screen always shows what the
 * server holds (the vehicle list is what decides onboarding vs home).
 */
export function MeProvider({ children }: { children: ReactNode }) {
  const { state } = useSession();
  // Keyed on the signed-in user: a sign-out or a new sign-in REMOUNTS the
  // state below, so nothing has to reset it by hand (and no effect sets
  // state synchronously).
  const key = state.status === 'signedIn' ? state.session.user.id : 'anonymous';
  return <MeState key={key}>{children}</MeState>;
}

function MeState({ children }: { children: ReactNode }) {
  const { state, api } = useSession();
  const [me, setMe] = useState<DriverMe | null>(null);
  // Seeded from the session, never set synchronously in an effect: the
  // keyed remount above is what puts a fresh sign-in at `loading`.
  const [status, setStatus] = useState<MeStatus>(() =>
    state.status === 'signedIn' ? 'loading' : 'idle',
  );

  const refetch = useCallback(async () => {
    try {
      const next = await api.request('GET', '/drivers/me', {
        schema: driverMeSchema,
      });
      setMe(next);
      setStatus('ready');
      return next;
    } catch {
      setStatus('error');
      return null;
    }
  }, [api]);

  // The initial load as a promise chain (not `refetch()`): the hooks rule
  // traces a called function for synchronous setState, and this shape is
  // the one it accepts. `refetch` serves every later re-read.
  useEffect(() => {
    if (state.status !== 'signedIn') return;
    let cancelled = false;
    api
      .request('GET', '/drivers/me', { schema: driverMeSchema })
      .then((next) => {
        if (cancelled) return;
        setMe(next);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [state.status, api]);

  const patchProfile = useCallback(
    async (patch: DriverProfileUpdate) => {
      await api.request('PATCH', '/drivers/me', {
        body: patch,
        schema: driverProfileSchema,
      });
      await refetch();
    },
    [api, refetch],
  );

  const createVehicle = useCallback(
    async (vehicle: VehicleCreate) => {
      const created = await api.request('POST', '/drivers/me/vehicles', {
        body: vehicle,
        schema: vehicleSchema,
      });
      await refetch();
      return created;
    },
    [api, refetch],
  );

  const updateVehicle = useCallback(
    async (id: string, patch: VehicleUpdate) => {
      const updated = await api.request('PATCH', `/drivers/me/vehicles/${id}`, {
        body: patch,
        schema: vehicleSchema,
      });
      await refetch();
      return updated;
    },
    [api, refetch],
  );

  const value = useMemo<MeContextValue>(
    () => ({ me, status, refetch, patchProfile, createVehicle, updateVehicle }),
    [me, status, refetch, patchProfile, createVehicle, updateVehicle],
  );
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}

export function useMe(): MeContextValue {
  const value = useContext(MeContext);
  if (value === null) throw new Error('useMe must be used inside <MeProvider>');
  return value;
}
