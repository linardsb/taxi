import { createRiderSocket } from './socket';

const mockIo = jest.fn();
jest.mock('socket.io-client', () => ({
  io: (...args: unknown[]) => mockIo(...args) as unknown,
}));

function fakeSocket() {
  const handlers = new Map<string, (arg: unknown) => void>();
  const socket = {
    // No `return socket` for chaining: it makes tsc infer the object as `any`
    // through its own initializer, and nothing under test chains `.on`.
    on: jest.fn((event: string, fn: (arg: unknown) => void) => {
      handlers.set(event, fn);
    }),
    disconnect: jest.fn(),
    connect: jest.fn(),
  };
  return { socket, handlers };
}

describe('createRiderSocket', () => {
  beforeEach(() => mockIo.mockReset());

  it("uses the library's own backoff and does not connect itself (expected)", () => {
    const { socket } = fakeSocket();
    mockIo.mockReturnValue(socket);

    createRiderSocket('tok', {
      url: 'http://api',
      onUnauthorized: jest.fn(),
    });

    // NEVER a hand-rolled reconnect loop — the console established this (#18).
    expect(mockIo).toHaveBeenCalledWith('http://api', {
      auth: { token: 'tok' },
      transports: ['websocket'],
      autoConnect: false,
      reconnectionDelay: 500,
      reconnectionDelayMax: 30_000,
      randomizationFactor: 0.5,
    });
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('signs out on a gateway `unauthorized` (failure — the dead-token path)', () => {
    const { socket, handlers } = fakeSocket();
    mockIo.mockReturnValue(socket);
    const onUnauthorized = jest.fn();
    createRiderSocket('dead', { url: 'http://api', onUnauthorized });

    handlers.get('connect_error')!(new Error('unauthorized'));

    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('leaves an ordinary connect error to the backoff (edge)', () => {
    const { socket, handlers } = fakeSocket();
    mockIo.mockReturnValue(socket);
    const onUnauthorized = jest.fn();
    createRiderSocket('tok', { url: 'http://api', onUnauthorized });

    // A transport blip is what the backoff is FOR — signing out on one would
    // end the session over a tunnel.
    handlers.get('connect_error')!(new Error('xhr poll error'));

    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
