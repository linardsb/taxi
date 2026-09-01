import { decide, initialPresence } from './presence-state';
import { runEffects } from './run-effects';

describe('runEffects', () => {
  it('runs effects in order, stops at the first throw and reports it once — and the report clears busy (failure)', async () => {
    const ran: string[] = [];
    const onThrow = jest.fn();

    await runEffects(
      [
        { type: 'persist_intent', intent: 'online' },
        { type: 'request_permissions' },
        { type: 'put_status', status: 'online' },
      ],
      (effect) => {
        ran.push(effect.type);
        return effect.type === 'request_permissions'
          ? Promise.reject(new Error('keystore'))
          : Promise.resolve();
      },
      onThrow,
    );

    expect(ran).toEqual(['persist_intent', 'request_permissions']);
    expect(onThrow).toHaveBeenCalledTimes(1);
    expect(onThrow).toHaveBeenCalledWith(new Error('keystore'));

    const stuck = decide(initialPresence, { type: 'toggle_pressed' }).state;
    expect(stuck.busy).toBe(true);
    const cleared = decide(stuck, { type: 'error', code: 'effect_failed' });
    expect(cleared.state.busy).toBe(false);
    expect(cleared.state.intent).toBe('offline');
    expect(cleared.state.banner?.kind).toBe('generic');
  });

  it("stops when `run` answers 'stop' — a refused put must not rebuild what flipOffline tore down (failure — review F32)", async () => {
    const ran: string[] = [];
    const onThrow = jest.fn();

    await runEffects(
      [
        { type: 'purge_stale_fixes' },
        { type: 'put_status', status: 'online' },
        { type: 'start_stream' },
        { type: 'connect_socket' },
        { type: 'keep_awake', on: true },
      ],
      (effect) => {
        ran.push(effect.type);
        return Promise.resolve(
          effect.type === 'put_status' ? ('stop' as const) : undefined,
        );
      },
      onThrow,
    );

    expect(ran).toEqual(['purge_stale_fixes', 'put_status']);
    expect(onThrow).not.toHaveBeenCalled();
  });
});
