import type {
  ClientToServerEmitEvents,
  ServerToClientEvents,
} from '@taxi/shared';
import { io, type Socket } from 'socket.io-client';
import { apiUrl } from '@/config';

/** Typed both ways from the shared contract — the app never retypes an event. */
export type RiderSocket = Socket<
  ServerToClientEvents,
  ClientToServerEmitEvents
>;

/**
 * The console's socket recipe (#18), minus the driver's ack helper — a rider
 * only listens. The library's own exponential backoff (500 ms → 30 s, ±50%
 * jitter), NEVER a hand-rolled loop; `autoConnect` off so the status screen
 * decides when. A `connect_error` of `unauthorized` is the gateway refusing a
 * dead token, and the session is over.
 */
export function createRiderSocket(
  token: string,
  opts: { url?: string; onUnauthorized: () => void },
): RiderSocket {
  const socket: RiderSocket = io(opts.url ?? apiUrl(), {
    auth: { token },
    transports: ['websocket'],
    autoConnect: false,
    reconnectionDelay: 500,
    reconnectionDelayMax: 30_000,
    randomizationFactor: 0.5,
  });
  socket.on('connect_error', (error) => {
    if (error.message === 'unauthorized') {
      socket.disconnect();
      opts.onUnauthorized();
    }
  });
  return socket;
}
