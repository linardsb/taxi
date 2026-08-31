import {
  decide,
  initialPresence,
  pillFrom,
  type Effect,
  type PresenceState,
} from './presence-state';

const types = (effects: Effect[]) => effects.map((e) => e.type);
const AT = '2026-08-31T10:00:00.000Z';
const online = (over: Partial<PresenceState> = {}): PresenceState => ({
  ...initialPresence,
  intent: 'online',
  server: 'online',
  streaming: true,
  socketConnected: true,
  ...over,
});

describe('decide — going online', () => {
  it('toggle from offline asks for permissions; granted → put_status, start_stream, connect_socket, keep_awake in that order (expected)', () => {
    const first = decide(initialPresence, { type: 'toggle_pressed' });
    expect(first.state.intent).toBe('online');
    expect(first.state.busy).toBe(true);
    expect(types(first.effects)).toEqual([
      'persist_intent',
      'persist_marked_offline',
      'request_permissions',
    ]);

    const second = decide(first.state, {
      type: 'permission',
      result: 'granted',
    });
    expect(types(second.effects)).toEqual([
      'put_status',
      'start_stream',
      'connect_socket',
      'keep_awake',
      'show_battery_prompt',
    ]);
    expect(second.effects[0]).toEqual({ type: 'put_status', status: 'online' });
    expect(second.effects[3]).toEqual({ type: 'keep_awake', on: true });
    expect(second.state.streaming).toBe(true);
  });

  it('a foreground denial flips back to offline with the banner; a background denial goes online with a warning (edge)', () => {
    const pending = decide(initialPresence, { type: 'toggle_pressed' }).state;

    const fg = decide(pending, {
      type: 'permission',
      result: 'foreground_denied',
    });
    expect(fg.state.intent).toBe('offline');
    expect(fg.state.banner?.kind).toBe('foreground_denied');
    expect(types(fg.effects)).toEqual(['persist_intent']);

    const bg = decide(pending, {
      type: 'permission',
      result: 'background_denied',
    });
    expect(bg.state.intent).toBe('online');
    expect(bg.state.banner?.kind).toBe('background_denied');
    expect(types(bg.effects)).toContain('start_stream');
  });

  it('a 409 on the put flips offline, tears down and names the reason (failure)', () => {
    const d = decide(online({ busy: true }), {
      type: 'error',
      code: 'vehicle_required',
    });

    expect(d.state.intent).toBe('offline');
    expect(d.state.busy).toBe(false);
    expect(d.state.banner?.kind).toBe('vehicle_required');
    expect(types(d.effects)).toEqual([
      'persist_intent',
      'stop_stream',
      'disconnect_socket',
      'keep_awake',
      'announce',
    ]);
    expect(d.effects[3]).toEqual({ type: 'keep_awake', on: false });
  });
});

describe('decide — the server disagrees', () => {
  it('ack_not_online re-asserts exactly once; a second one flips with the marked_offline banner (edge)', () => {
    const first = decide(online(), { type: 'ack_not_online', at: AT });
    expect(first.state.reasserted).toBe(true);
    expect(first.effects).toEqual([{ type: 'put_status', status: 'online' }]);

    // The server accepts; the uploader drains; the accepted fix clears the flag.
    const back = decide(first.state, { type: 'server_online' });
    expect(types(back.effects)).toEqual(['kick_uploader', 'announce']);
    const acked = decide(back.state, { type: 'ack', at: 1, queued: 0 });
    expect(acked.state.reasserted).toBe(false);

    // …but with no fix in between, the second refusal wins.
    const second = decide(first.state, { type: 'ack_not_online', at: AT });
    expect(second.state.intent).toBe('offline');
    expect(second.state.banner).toEqual({ kind: 'marked_offline', at: AT });
    expect(types(second.effects)).toContain('persist_marked_offline');
    expect(types(second.effects)).toContain('stop_stream');
  });

  it('server_offline from a foreground refetch while streaming re-asserts (edge — the forced_offline case)', () => {
    const d = decide(online(), { type: 'server_offline', at: AT });
    expect(d.effects).toEqual([{ type: 'put_status', status: 'online' }]);
    expect(d.state.busy).toBe(true);
    // …and the 409 that follows flips with the reason, not a generic banner.
    const refused = decide(d.state, {
      type: 'error',
      code: 'vehicle_required',
    });
    expect(refused.state.banner?.kind).toBe('vehicle_required');
  });

  it('a reconnect re-asserts intent and the server answer kicks the uploader (expected)', () => {
    const connect = decide(
      online({ socketConnected: false, lastAckAt: null }),
      {
        type: 'socket_connect',
      },
    );
    expect(connect.state.socketConnected).toBe(true);
    expect(connect.effects).toEqual([{ type: 'put_status', status: 'online' }]);

    const answered = decide(connect.state, { type: 'server_online' });
    expect(types(answered.effects)).toEqual(['kick_uploader']);
  });
});

describe('decide — going offline and cold launch', () => {
  it('toggle from online drains first, then puts offline and tears down (expected — no fix refused as not_online)', () => {
    const d = decide(online(), { type: 'toggle_pressed' });
    expect(d.state.intent).toBe('offline');
    expect(types(d.effects)).toEqual(['persist_intent', 'drain_then_clear']);

    const drained = decide(d.state, { type: 'drained' });
    expect(types(drained.effects)).toEqual([
      'put_status',
      'stop_stream',
      'disconnect_socket',
      'keep_awake',
    ]);
    expect(drained.effects[0]).toEqual({
      type: 'put_status',
      status: 'offline',
    });
  });

  it('cold launch with the task alive re-asserts without a tap; with it dead shows the banner only (edge — D14)', () => {
    const alive = decide(initialPresence, {
      type: 'cold_launch',
      intent: 'online',
      streaming: true,
      markedOfflineAt: null,
      queued: 12,
      now: AT,
    });
    expect(alive.state.intent).toBe('online');
    expect(alive.state.queued).toBe(12);
    expect(types(alive.effects)).toEqual([
      'put_status',
      'connect_socket',
      'keep_awake',
    ]);

    const dead = decide(initialPresence, {
      type: 'cold_launch',
      intent: 'online',
      streaming: false,
      markedOfflineAt: AT,
      queued: 3,
      now: '2026-08-31T11:00:00.000Z',
    });
    expect(dead.state.intent).toBe('offline');
    expect(dead.state.banner).toEqual({ kind: 'marked_offline', at: AT });
    expect(types(dead.effects)).toEqual(['persist_intent']);

    const wasOffline = decide(initialPresence, {
      type: 'cold_launch',
      intent: 'offline',
      streaming: false,
      markedOfflineAt: null,
      queued: 0,
      now: AT,
    });
    expect(wasOffline.effects).toEqual([]);
  });

  it('ignores a toggle while a transition is in flight (failure)', () => {
    const busy = decide(initialPresence, { type: 'toggle_pressed' }).state;
    expect(decide(busy, { type: 'toggle_pressed' })).toEqual({
      state: busy,
      effects: [],
    });
  });
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
