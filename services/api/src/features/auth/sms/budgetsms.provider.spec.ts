import { Logger } from '@nestjs/common';
import { formatMessage } from '@taxi/shared';
import { BudgetSmsProvider } from './budgetsms.provider';

const CONFIG = {
  username: 'saktacab',
  userid: '123456',
  handle: 'handle-secret',
  from: 'SaktaCab',
};

/** Captures every (url, init) and answers with one canned Response. */
function fakeFetch(status: number, body: string) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = ((url: unknown, init?: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    return Promise.resolve(new Response(body, { status }));
  }) as typeof fetch;
  return { fn, calls };
}

const sentLog = (log: jest.SpyInstance) =>
  (log.mock.calls as unknown as [Record<string, unknown>][])
    .map(([payload]) => payload)
    .find((payload) => payload.event === 'auth.sms.budgetsms_sent');

describe('BudgetSmsProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('GETs the send endpoint with every mandatory param, the + stripped, and price=1 (expected)', async () => {
    const { fn, calls } = fakeFetch(200, 'OK 1234567 0.055 1');

    await new BudgetSmsProvider(CONFIG, fn).send(
      '+37120000001',
      'Jūsu taksometrs ir rezervēts.',
    );

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://api.budgetsms.net/sendsms/',
    );
    // By searchParams, not a string match: parameter order is an
    // implementation detail and a string assertion pins it by accident.
    expect(Object.fromEntries(url.searchParams)).toEqual({
      username: 'saktacab',
      userid: '123456',
      handle: 'handle-secret',
      msg: 'Jūsu taksometrs ir rezervēts.',
      from: 'SaktaCab',
      // No leading `+`: BudgetSMS §2 rejects it with 2010/2011.
      to: '37120000001',
      // Without price=1 the success line has no parts field at all.
      price: '1',
    });
    // GET: the method is left unset rather than spelled, and the timeout is wired.
    expect(calls[0]!.init.method).toBeUndefined();
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('logs budgetsms_sent with segments parsed from the OK line, the masked phone, and never the body (expected)', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const { fn } = fakeFetch(200, 'OK 1234567 0.055 1');

    await new BudgetSmsProvider(CONFIG, fn).send(
      '+37120000001',
      'secret body 123456',
    );

    expect(sentLog(log)).toMatchObject({
      event: 'auth.sms.budgetsms_sent',
      segments: 1,
      phone: '+371*****001',
      smsId: '1234567',
    });
    const serialized = JSON.stringify(sentLog(log));
    expect(serialized).not.toContain('secret body');
    // Spelled WITHOUT the `+`, which catches both forms: `send()` strips it
    // for the `to` param, so an unmasked copy of the wire number in this
    // payload slips past an assertion spelled `+37120000001`. The ERR-path
    // assertion below already gets this right.
    expect(serialized).not.toContain('37120000001');
  });

  it('sendOtp sends the lv catalog body with the code interpolated (expected)', async () => {
    const { fn, calls } = fakeFetch(200, 'OK 1234567 0.055 1');

    await new BudgetSmsProvider(CONFIG, fn).sendOtp('+37120000001', '123456');

    const msg = new URL(calls[0]!.url).searchParams.get('msg');
    expect(msg).toBe(formatMessage('lv', 'sms.otp_code', { code: '123456' }));
    expect(msg).toBe('Sakta Cab kods: 123456');
  });

  it('reads a two-segment success from the trailing parts token (edge)', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const { fn } = fakeFetch(200, 'OK 1234567 0.110 2');

    await new BudgetSmsProvider(CONFIG, fn).send('+37120000001', 'x');

    expect(sentLog(log)).toMatchObject({ segments: 2 });
  });

  it('honours a baseUrl override so the bake-off can pre-flight against /testsms/ (edge)', async () => {
    // The four-token body is `/sendsms/`'s documented shape, asserted here
    // only to show the override changes the endpoint and nothing else. What
    // `/testsms/` actually replies is NOT SOURCED — see the next case.
    const { fn, calls } = fakeFetch(200, 'OK 1234567 0.000 1');

    await new BudgetSmsProvider(
      { ...CONFIG, baseUrl: 'https://api.budgetsms.net/testsms/' },
      fn,
    ).send('+37120000001', 'x');

    // Same request-building and response-parsing code, different endpoint —
    // which is the whole point of the pre-flight being a config value rather
    // than a flag inside the provider.
    const url = new URL(calls[0]!.url);
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://api.budgetsms.net/testsms/',
    );
    expect(url.searchParams.get('handle')).toBe('handle-secret');
  });

  it('accepts a bare OK, with no smsId and one segment (edge)', async () => {
    // `/testsms/`'s reply shape is unsourced, and the free pre-flight runs
    // this parser against it. Under `startsWith('OK ')` a bare `OK` threw
    // `budgetsms_error_200`, so the one step that exists to prove the
    // credentials work would have reported all three handsets broken.
    //
    // This is the widening's own cost, pinned rather than left to be
    // discovered: there is no id to log, and the segment count falls back to
    // 1 exactly as it does for a `/sendsms/` reply with no parts field.
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const { fn } = fakeFetch(200, 'OK');

    await new BudgetSmsProvider(CONFIG, fn).send('+37120000001', 'x');

    expect(sentLog(log)).toMatchObject({ segments: 1 });
    expect(sentLog(log)!.smsId).toBeUndefined();
  });

  it('falls back to the status when the ERR code is not numeric (failure)', async () => {
    // `errorCode` promises the caller that "only the code crosses". Without a
    // shape check, this vendor text would be the Error.message that
    // `auth.service.ts` logs verbatim.
    const { fn } = fakeFetch(200, 'ERR account-suspended-37120000001');

    await expect(
      new BudgetSmsProvider(CONFIG, fn).send('+37120000001', 'x'),
    ).rejects.toThrow('budgetsms_error_200');
  });

  it('rejects on ERR delivered with an HTTP 200 (failure)', async () => {
    // THE PIN. BudgetSMS signals failure in the BODY, not the status, and the
    // spec documents no non-200 for it. An implementation that branches on
    // `res.ok` passes every other case in this file and fails only this one —
    // logging a failed send as a success and charging the ledger a segment
    // that was never sent.
    const { fn } = fakeFetch(200, 'ERR 3001');

    await expect(
      new BudgetSmsProvider(CONFIG, fn).send('+37120000001', 'x'),
    ).rejects.toThrow('budgetsms_error_3001');
  });

  it('rejects leak-free on both the ERR path and a 500 HTML body (failure)', async () => {
    const capture = (provider: BudgetSmsProvider) =>
      provider.send('+37120000001', 'secret body 123456').then(
        () => {
          throw new Error('expected send() to reject');
        },
        (e: Error) => e,
      );

    // The leak pin: auth.service.ts logs err.message VERBATIM, so it must
    // carry neither the destination number (in either spelling — the wire
    // form drops the `+`) nor the SMS body.
    const errBody = await capture(
      new BudgetSmsProvider(CONFIG, fakeFetch(200, 'ERR 2010 +37120000001').fn),
    );
    expect(errBody.message).toBe('budgetsms_error_2010');
    expect(errBody.message).not.toContain('37120000001');
    expect(errBody.message).not.toContain('secret body');

    const errHttp = await capture(
      new BudgetSmsProvider(
        CONFIG,
        fakeFetch(500, '<html>Internal Server Error</html>').fn,
      ),
    );
    expect(errHttp.message).toBe('budgetsms_error_500');
    expect(errHttp.message).not.toContain('37120000001');
    expect(errHttp.message).not.toContain('secret body');
  });
});
