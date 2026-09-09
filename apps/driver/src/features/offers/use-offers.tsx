import {
  rideOfferEventSchema,
  rideOfferSchema,
  RT,
  RT_EVENT_SCHEMAS,
  type RideOfferEvent,
} from '@taxi/shared';
import { usePathname, useRouter } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AccessibilityInfo } from 'react-native';
import { useActiveRide } from '@/features/active-ride';
import { ApiError, useSession } from '@/features/auth';
import { useT } from '@/features/i18n';
import {
  getLocationRuntime,
  type DriverSocket,
  type LatestFix,
} from '@/features/location';
import { runEffects } from '@/lib/run-effects';
import {
  decide,
  initialOffers,
  type OfferEffect,
  type OfferEvent,
  type OfferState,
} from './offer-state';
import { useOfferAlerts } from './use-offer-alerts';

export interface OffersContextValue {
  state: OfferState;
  /** The phone's newest fix — pickup distance on the card. */
  latest: LatestFix | null;
  accept(): void;
  decline(): void;
  dismissBanner(): void;
  /** The push path's entry: the same wire event the socket delivers. */
  receive(event: RideOfferEvent, source: 'socket' | 'push'): void;
}

const OffersContext = createContext<OffersContextValue | null>(null);

/** `POST /dispatch/offers/:id/accept` → `{ rideId }`; the api-client keeps zod out. */
const acceptResponse = {
  parse: (input: unknown): { rideId: string } => {
    const rideId = (input as { rideId?: unknown } | null)?.rideId;
    if (typeof rideId !== 'string') throw new Error('accept: no rideId');
    return { rideId };
  },
};

const codeOf = (error: unknown) =>
  error instanceof ApiError ? error.code : 'generic';

/**
 * Runs the offer reducer and executes its effects: REST accept/decline, the
 * tone + haptics, routing to and from `/offer`, and the hand-over to the
 * active-ride provider. Listens on whatever socket the location runtime
 * holds — presence sets it BEFORE `connect()`, so nothing is missed.
 */
export function OffersProvider({ children }: { children: ReactNode }) {
  const { api } = useSession();
  const activeRide = useActiveRide();
  const router = useRouter();
  const pathname = usePathname();
  const t = useT();
  const [state, setState] = useState<OfferState>(initialOffers);
  const [latest, setLatest] = useState<LatestFix | null>(null);
  const stateRef = useRef(state);
  const pathnameRef = useRef(pathname);
  const tRef = useRef(t);
  const openRef = useRef(activeRide.open);
  useEffect(() => {
    pathnameRef.current = pathname;
    tRef.current = t;
    openRef.current = activeRide.open;
  }, [pathname, t, activeRide.open]);
  const alerts = useOfferAlerts(state.remainingMs);
  const alertsRef = useRef(alerts);
  useEffect(() => {
    alertsRef.current = alerts;
  }, [alerts]);
  const runRef = useRef<(effect: OfferEffect) => Promise<void | 'stop'>>(() =>
    Promise.resolve(),
  );

  const dispatch = useCallback(function dispatch(event: OfferEvent) {
    const { state: next, effects } = decide(stateRef.current, event);
    stateRef.current = next;
    setState(next);
    if (effects.length === 0) return;
    void runEffects(
      effects,
      (effect) => runRef.current(effect),
      (error) => dispatch({ type: 'rejected', code: codeOf(error) }),
    );
  }, []);

  const run = async (effect: OfferEffect): Promise<void | 'stop'> => {
    switch (effect.type) {
      case 'post_accept':
        try {
          const { rideId } = await api.request(
            'POST',
            `/dispatch/offers/${effect.offerId}/accept`,
            { schema: acceptResponse },
          );
          dispatch({ type: 'accepted', rideId });
        } catch (error) {
          dispatch({ type: 'rejected', code: codeOf(error) });
        }
        return;
      case 'post_decline':
        // The card is gone either way; a failed decline is the sweeper's to expire.
        await api
          .request('POST', `/dispatch/offers/${effect.offerId}/decline`)
          .catch(() => undefined);
        dispatch({ type: 'declined' });
        return;
      case 'open_ride':
        openRef.current(effect.rideId, effect.paymentMethod);
        router.replace('/active-ride');
        return;
      case 'route_offer':
        // `navigate`, not `push`: a push tap routes here too, and two hops to
        // the same route must land on ONE offer screen, not a stacked pair.
        if (pathnameRef.current !== '/offer') router.navigate('/offer');
        return;
      case 'route_home':
        if (pathnameRef.current === '/offer') router.replace('/home');
        return;
      case 'alert_start':
        alertsRef.current.start();
        return;
      case 'alert_stop':
        alertsRef.current.stop();
        return;
      case 'announce':
        AccessibilityInfo.announceForAccessibility(tRef.current(effect.key));
        return;
    }
  };
  useEffect(() => {
    runRef.current = run;
  });

  const receive = useCallback(
    (event: RideOfferEvent, source: 'socket' | 'push') => {
      // The domain object re-hydrates the two dates and strips the wire-only
      // `paymentMethod`, which travels beside it on the card.
      const offer = rideOfferSchema.parse(event);
      dispatch({
        type: 'offer_received',
        pending: {
          offer,
          paymentMethod: event.paymentMethod,
          receivedAtMs: Date.now(),
          durationMs: offer.expiresAt.getTime() - offer.sentAt.getTime(),
          source,
        },
      });
    },
    [dispatch],
  );

  // The socket's three offer-side events, parsed before they touch the reducer.
  useEffect(() => {
    let detach: (() => void) | null = null;
    const attach = (socket: DriverSocket | null) => {
      detach?.();
      detach = null;
      if (!socket) return;
      const onOffer = (payload: unknown) => {
        const parsed = rideOfferEventSchema.safeParse(payload);
        if (!parsed.success) {
          console.warn('ride:offer dropped', parsed.error.issues[0]?.message);
          return;
        }
        receive(parsed.data, 'socket');
      };
      const onRevoked = (payload: unknown) => {
        const parsed = RT_EVENT_SCHEMAS[RT.rideOfferRevoked].safeParse(payload);
        if (!parsed.success) {
          console.warn(
            'ride:offer_revoked dropped',
            parsed.error.issues[0]?.message,
          );
          return;
        }
        dispatch({
          type: 'revoked',
          offerId: parsed.data.offerId,
          reason: parsed.data.reason,
        });
      };
      const onQueue = (payload: unknown) => {
        const parsed = RT_EVENT_SCHEMAS[RT.driverQueue].safeParse(payload);
        if (!parsed.success) {
          console.warn('driver:queue dropped', parsed.error.issues[0]?.message);
          return;
        }
        dispatch({ type: 'queue', event: parsed.data });
      };
      socket.on(RT.rideOffer, onOffer);
      socket.on(RT.rideOfferRevoked, onRevoked);
      socket.on(RT.driverQueue, onQueue);
      detach = () => {
        socket.off(RT.rideOffer, onOffer);
        socket.off(RT.rideOfferRevoked, onRevoked);
        socket.off(RT.driverQueue, onQueue);
      };
    };
    const unsubscribe = getLocationRuntime().subscribe({
      onSocket: attach,
      onLatestFix: (fix) => {
        setLatest(fix);
        dispatch({ type: 'speed', mps: fix.speedMps });
      },
    });
    return () => {
      unsubscribe();
      detach?.();
    };
  }, [dispatch, receive]);

  // The 1 s clock, only while a card is up.
  useEffect(() => {
    if (state.phase === 'idle') return;
    const timer = setInterval(
      () => dispatch({ type: 'tick', nowMs: Date.now() }),
      1_000,
    );
    return () => clearInterval(timer);
  }, [state.phase, dispatch]);

  const accept = useCallback(
    () => dispatch({ type: 'accept_pressed' }),
    [dispatch],
  );
  const decline = useCallback(
    () => dispatch({ type: 'decline_pressed' }),
    [dispatch],
  );
  const dismissBanner = useCallback(
    () => dispatch({ type: 'banner_dismissed' }),
    [dispatch],
  );

  const value = useMemo<OffersContextValue>(
    () => ({ state, latest, accept, decline, dismissBanner, receive }),
    [state, latest, accept, decline, dismissBanner, receive],
  );
  return (
    <OffersContext.Provider value={value}>{children}</OffersContext.Provider>
  );
}

export function useOffers(): OffersContextValue {
  const value = useContext(OffersContext);
  if (value === null) {
    throw new Error('useOffers must be used inside <OffersProvider>');
  }
  return value;
}
