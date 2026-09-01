import {
  driverLocationAckSchema,
  RT,
  type ClientToServerEmitEvents,
  type DriverLocationAck,
  type DriverLocationPing,
  type ServerToClientEvents,
} from '@taxi/shared';
import { io, type Socket } from 'socket.io-client';
import { apiUrl } from '@/config';

/** Typed both ways from the shared contract — the app never retypes an event. */
export type DriverSocket = Socket<
  ServerToClientEvents,
  ClientToServerEmitEvents
>;

/**
 * The console's socket recipe (#18): the library's own exponential backoff
 * (500 ms → 30 s, ±50 % jitter), never a hand-rolled loop; `autoConnect`
 * off so presence decides when. A `connect_error` of `unauthorized` is the
 * gateway refusing a dead token — the session is over.
 */
export function createDriverSocket(
  token: string,
  opts: { url?: string; onUnauthorized: () => void },
): DriverSocket {
  const socket: DriverSocket = io(opts.url ?? apiUrl(), {
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

/** `'timeout'` and `'disconnected'` both mean "keep the fix, try again". */
export type EmitOutcome = DriverLocationAck | 'timeout' | 'disconnected';

/**
 * One ping, one ack. An unparseable ack is treated as a timeout — retrying
 * is the safe reading of an answer we cannot read.
 */
export function emitFixWithAck(
  socket: DriverSocket,
  ping: DriverLocationPing,
  timeoutMs: number,
): Promise<EmitOutcome> {
  if (!socket.connected) return Promise.resolve('disconnected');
  return new Promise((resolve) => {
    socket
      .timeout(timeoutMs)
      .emit(
        RT.driverLocation,
        ping,
        (err: Error | null, response?: unknown) => {
          if (err) {
            resolve('timeout');
            return;
          }
          const parsed = driverLocationAckSchema.safeParse(response);
          resolve(parsed.success ? parsed.data : 'timeout');
        },
      );
  });
}
