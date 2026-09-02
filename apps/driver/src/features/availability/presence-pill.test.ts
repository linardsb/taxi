import { pillFrom } from './presence-pill';
import { initialPresence, type PresenceState } from './presence-state';

const online = (over: Partial<PresenceState> = {}): PresenceState => ({
  ...initialPresence,
  intent: 'online',
  server: 'online',
  streaming: true,
  socketConnected: true,
  ...over,
});

describe('pillFrom', () => {
  it('derives live / reconnecting / offline from the last ack, and nothing while offline', () => {
    const now = 1_800_000_000_000;
    expect(pillFrom(initialPresence, now)).toBeNull();
    expect(pillFrom(online({ lastAckAt: null }), now)).toBe('reconnecting');
    expect(pillFrom(online({ lastAckAt: now - 5_000 }), now)).toBe('live');
    expect(pillFrom(online({ lastAckAt: now - 30_000 }), now)).toBe(
      'reconnecting',
    );
    expect(pillFrom(online({ lastAckAt: now - 61_000 }), now)).toBe('offline');
  });
});
