import {
  decide,
  initialPresence,
  serverStatusEvent,
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
    // The purge comes first: `put_status`'s answer is what kicks the uploader.
    expect(types(second.effects)).toEqual([
      'purge_stale_fixes',
      'put_status',
      'start_stream',
      'connect_socket',
      'keep_awake',
      'show_battery_prompt',
    ]);
    expect(second.effects[1]).toEqual({ type: 'put_status', status: 'online' });
    expect(second.effects[4]).toEqual({ type: 'keep_awake', on: true });
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
    // `busy` gates the foreground refetch for the put's RTT (review F35).
    expect(first.state.busy).toBe(true);
    expect(first.effects).toEqual([{ type: 'put_status', status: 'online' }]);

    // The server accepts; the uploader drains; the accepted fix clears the flag.
    const back = decide(first.state, { type: 'server_online' });
    expect(types(back.effects)).toEqual(['kick_uploader', 'announce']);
    // …and the gate comes back down, or the toggle stays stuck spinning.
    expect(back.state.busy).toBe(false);
    const acked = decide(back.state, { type: 'ack', at: 1, queued: 0 });
    expect(acked.state.reasserted).toBe(false);

    // …but with no fix in between, the second refusal wins.
    const second = decide(first.state, { type: 'ack_not_online', at: AT });
    expect(second.state.intent).toBe('offline');
    expect(second.state.busy).toBe(false);
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
      'stop_uploader',
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
      'purge_stale_fixes',
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

describe('decide — the server holds us', () => {
  it('on_ride from a refetch or a reconnect reads as online: no re-assert, the stream kept (edge — the force-assigned driver)', () => {
    expect(serverStatusEvent('on_ride', AT)).toEqual({ type: 'server_online' });
    expect(serverStatusEvent('online', AT)).toEqual({ type: 'server_online' });
    expect(serverStatusEvent('offline', AT)).toEqual({
      type: 'server_offline',
      at: AT,
    });

    const d = decide(online(), serverStatusEvent('on_ride', AT));
    expect(types(d.effects)).not.toContain('put_status');
    expect(types(d.effects)).not.toContain('stop_stream');
    expect(d.state.intent).toBe('online');
    expect(d.state.streaming).toBe(true);
  });

  it('a reconnect mid-ride re-asserts, and the on_ride ack keeps the stream — no teardown (edge — review F3: the Wi-Fi handover on a force-assigned ride)', () => {
    const connect = decide(online(), { type: 'socket_connect' });
    expect(connect.effects).toEqual([{ type: 'put_status', status: 'online' }]);

    // The api answers an online re-assert while held with the on_ride
    // profile (no 409 — `setPresence` refuses only `offline` while held).
    const answered = decide(connect.state, serverStatusEvent('on_ride', AT));
    expect(types(answered.effects)).not.toContain('stop_stream');
    expect(answered.state.intent).toBe('online');
    expect(answered.state.streaming).toBe(true);
    expect(answered.state.server).toBe('online');
  });

  it('a foreground denial while the server already holds us online tells it and tears down; otherwise nothing to tell (edge)', () => {
    const pending = decide(initialPresence, { type: 'toggle_pressed' }).state;

    const held = decide(
      { ...pending, server: 'online' },
      { type: 'permission', result: 'foreground_denied' },
    );
    expect(held.state.intent).toBe('offline');
    expect(held.state.busy).toBe(true); // the offline put's answer clears it
    expect(types(held.effects)).toEqual([
      'persist_intent',
      'put_status',
      'stop_stream',
      'disconnect_socket',
      'keep_awake',
    ]);
    expect(held.effects[1]).toEqual({ type: 'put_status', status: 'offline' });
    expect(
      decide(held.state, { type: 'server_offline', at: AT }).state.busy,
    ).toBe(false);

    const quiet = decide(pending, {
      type: 'permission',
      result: 'foreground_denied',
    });
    expect(types(quiet.effects)).toEqual(['persist_intent']);
    expect(quiet.state.busy).toBe(false);
  });

  it('a refused offline put while streaming holds us online: no teardown, no lie about the server (failure — #141/F38)', () => {
    const pressed = decide(online(), { type: 'toggle_pressed' });
    const drained = decide(pressed.state, { type: 'drained' });
    // The stop and the teardown both queue BEHIND the put. That ordering is
    // the fix: the chain skips everything after an answer that disagrees.
    expect(types(drained.effects)).toEqual([
      'put_status',
      'stop_uploader',
      'stop_stream',
      'disconnect_socket',
      'keep_awake',
    ]);

    const held = decide(drained.state, {
      type: 'error',
      code: 'driver_on_ride',
      status: 'offline',
    });
    expect(held.state.intent).toBe('online');
    expect(held.state.server).toBe('online');
    expect(held.state.streaming).toBe(true);
    expect(held.state.busy).toBe(false);
    expect(held.state.banner?.kind).toBe('driver_on_ride');
    // `toEqual` on the whole list, not `not.toContain('stop_stream')`: only
    // the whole list proves nothing at all was torn down.
    expect(types(held.effects)).toEqual(['persist_intent', 'kick_uploader']);
    expect(held.effects[0]).toEqual({
      type: 'persist_intent',
      intent: 'online',
    });
  });

  it('the same refusal with no stream still flips offline: we cannot prove life (edge)', () => {
    const d = decide(online({ streaming: false, busy: true }), {
      type: 'error',
      code: 'driver_on_ride',
      status: 'offline',
    });
    expect(d.state.intent).toBe('offline');
    expect(types(d.effects)).toContain('stop_stream');
  });

  it('a network failure on the offline put leaves intent offline and emits nothing — the chain, not the reducer, does the teardown (edge)', () => {
    const pressed = decide(online(), { type: 'toggle_pressed' });
    const drained = decide(pressed.state, { type: 'drained' });

    const failed = decide(drained.state, {
      type: 'error',
      code: 'offline',
      status: 'offline',
    });
    expect(failed.state.busy).toBe(false);
    expect(failed.state.intent).toBe('offline');
    // This does NOT prove the teardown runs — the reducer emits nothing here.
    // The teardown is the outer chain carrying on past the `'stop'`
    // predicate, which `use-presence.test.tsx` owns. All this pins is the
    // value that predicate reads.
    expect(failed.effects).toEqual([]);
  });

  it('a half-torn-down app is NOT restored: the effect_failed fold has no stream to offer (failure — the F31 guard)', () => {
    const fold = decide(online(), { type: 'error', code: 'effect_failed' });
    // The fold emits the offline put off the PRE-fold `server: 'online'`…
    expect(fold.effects[0]).toEqual({ type: 'put_status', status: 'offline' });
    // …while folding `streaming` false, so the 409 answering that put lands
    // on a state with nothing streaming.
    expect(fold.state.streaming).toBe(false);

    const refused = decide(fold.state, {
      type: 'error',
      code: 'driver_on_ride',
      status: 'offline',
    });
    // The fallback, not the held branch: restoring `intent: 'online'` over a
    // half-torn-down app is review F31's ghost toggle.
    expect(refused.state.intent).toBe('offline');
  });
});

describe('decide — effect failures', () => {
  it('a throw in the go-online chain folds to offline and tears down — no ghost toggle (failure — review F31)', () => {
    const stuck = decide(initialPresence, { type: 'toggle_pressed' }).state;

    const folded = decide(stuck, { type: 'error', code: 'effect_failed' });
    expect(folded.state.intent).toBe('offline');
    expect(folded.state.busy).toBe(false);
    expect(folded.state.banner?.kind).toBe('generic');
    // The server was never told anything, so there is nothing to un-tell.
    // `persist_intent` comes LAST, so a throwing store cannot block the
    // teardown, and SecureStore does not keep saying «online» (review F44).
    expect(types(folded.effects)).toEqual([
      'stop_stream',
      'disconnect_socket',
      'keep_awake',
      'persist_intent',
    ]);
    expect(folded.effects.at(-1)).toEqual({
      type: 'persist_intent',
      intent: 'offline',
    });

    // …with the server already holding us online, it is told first.
    const held = decide(
      { ...stuck, server: 'online' },
      { type: 'error', code: 'effect_failed' },
    );
    expect(types(held.effects)).toEqual([
      'put_status',
      'stop_stream',
      'disconnect_socket',
      'keep_awake',
      'persist_intent',
    ]);
    expect(held.effects[0]).toEqual({ type: 'put_status', status: 'offline' });

    // …and a second throw is a no-op from EITHER fold — including the one
    // that emitted a put, whose `server` the fold must clear. Without that,
    // an unwrapped teardown throw (`disconnect_socket`, `keep_awake off`)
    // re-emitted this identical list for as long as the offline put could
    // not land: a retry loop on the driver's battery (review F37).
    for (const first of [folded.state, held.state]) {
      expect(first.server).toBeNull();
      expect(
        decide(first, { type: 'error', code: 'effect_failed' }).effects,
      ).toEqual([]);
    }
  });

  it('a failed offline put keeps the «grant location» banner — generic never overwrites guidance (edge — review F34)', () => {
    const pending = decide(initialPresence, { type: 'toggle_pressed' }).state;
    const denied = decide(
      { ...pending, server: 'online' },
      { type: 'permission', result: 'foreground_denied' },
    );
    expect(denied.state.banner?.kind).toBe('foreground_denied');

    const failed = decide(denied.state, {
      type: 'error',
      code: 'validation_failed',
    });
    expect(failed.state.banner?.kind).toBe('foreground_denied');
    expect(failed.state.busy).toBe(false);
  });

  it('background_denied guidance survives the fold — it is the banner up while online (edge — review F42)', () => {
    const pending = decide(initialPresence, { type: 'toggle_pressed' }).state;
    const denied = decide(pending, {
      type: 'permission',
      result: 'background_denied',
    });
    // A mounted phone streams anyway, so this banner is up during the window
    // when generic errors actually arrive.
    expect(denied.state.banner?.kind).toBe('background_denied');
    expect(denied.state.streaming).toBe(true);

    // F36's exact trace: the online put lands, `start_stream` then throws.
    const failed = decide(
      { ...denied.state, server: 'online' },
      { type: 'error', code: 'effect_failed' },
    );
    expect(failed.state.intent).toBe('offline');
    // «grant background location», not «something went wrong».
    expect(failed.state.banner?.kind).toBe('background_denied');
  });
});
