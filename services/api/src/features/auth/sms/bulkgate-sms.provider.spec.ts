import { Logger } from '@nestjs/common';
import { formatMessage } from '@taxi/shared';
import { BulkGateSmsProvider } from './bulkgate-sms.provider';

const CONFIG = {
  applicationId: '12345',
  applicationToken: 'application-token-secret',
  senderIdValue: 'SaktaCab',
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

/** The vendor's own documented success envelope — three ids for two parts. */
const ACCEPTED = JSON.stringify({
  data: {
    status: 'accepted',
    sms_id: 'tmpde1bcd4b1d1',
    part_id: ['tmpde1bcd4b1d1_1', 'tmpde1bcd4b1d1_2', 'tmpde1bcd4b1d1'],
    number: '37120000001',
  },
});

const sentLog = (log: jest.SpyInstance) =>
  (log.mock.calls as unknown as [Record<string, unknown>][])
    .map(([payload]) => payload)
    .find((payload) => payload.event === 'auth.sms.bulkgate_sent');

describe('BulkGateSmsProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('POSTs the transactional endpoint as JSON with the gText sender and resolves on 200 (expected)', async () => {
    const { fn, calls } = fakeFetch(200, ACCEPTED);

    await new BulkGateSmsProvider(CONFIG, fn).send(
      '+37120000001',
      'Jūsu taksometrs ir rezervēts.',
    );

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe(
      'https://portal.bulkgate.com/api/1.0/simple/transactional',
    );
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
    // A JSON string, not a URLSearchParams — Twilio's `form.get('To')` shape
    // does not carry over here.
    expect(JSON.parse(init.body as string)).toEqual({
      application_id: CONFIG.applicationId,
      application_token: CONFIG.applicationToken,
      number: '+37120000001',
      text: 'Jūsu taksometrs ir rezervēts.',
      unicode: true,
      sender_id: 'gText',
      sender_id_value: 'SaktaCab',
      country: 'lv',
    });
  });

  it('logs bulkgate_sent with segments counted from the suffixed part ids, the masked phone, and never the body (expected)', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const { fn } = fakeFetch(200, ACCEPTED);

    await new BulkGateSmsProvider(CONFIG, fn).send(
      '+37120000001',
      'secret body 123456',
    );

    // TWO, not three: the documented envelope returns the bare id alongside
    // the two suffixed ones, so `part_id.length` over-counts. The "SMS spend
    // €/week" ledger row reads `segments`.
    expect(sentLog(log)).toMatchObject({
      event: 'auth.sms.bulkgate_sent',
      segments: 2,
      phone: '+371*****001',
      smsId: 'tmpde1bcd4b1d1',
    });
    // Same leak rule as err.message: the log carries neither the SMS body
    // (OTP codes, tracking links) nor the raw phone.
    const serialized = JSON.stringify(sentLog(log));
    expect(serialized).not.toContain('secret body');
    expect(serialized).not.toContain('+37120000001');
  });

  it('sendOtp sends the lv catalog body with the code interpolated (expected)', async () => {
    const { fn, calls } = fakeFetch(200, ACCEPTED);

    await new BulkGateSmsProvider(CONFIG, fn).sendOtp('+37120000001', '123456');

    const body = JSON.parse(calls[0]!.init.body as string) as { text: string };
    expect(body.text).toBe(
      formatMessage('lv', 'sms.otp_code', { code: '123456' }),
    );
    expect(body.text).toBe('Sakta Cab kods: 123456');
  });

  it('counts a single-part success as 1 segment, not 0 (edge)', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const { fn } = fakeFetch(
      200,
      JSON.stringify({ data: { sms_id: 'tmpx', part_id: ['tmpx'] } }),
    );

    await new BulkGateSmsProvider(CONFIG, fn).send('+37120000001', 'x');

    // Zero suffixed entries is a one-part send, never a zero-part one — a
    // `segments: 0` row would under-bill the ledger.
    expect(sentLog(log)).toMatchObject({ segments: 1 });
  });

  it('detects the encoding rather than hardcoding it: ASCII sends unicode false, LV sends true (edge)', async () => {
    const { fn, calls } = fakeFetch(200, ACCEPTED);
    const provider = new BulkGateSmsProvider(CONFIG, fn);

    await provider.send(
      '+37120000001',
      formatMessage('lv', 'sms.otp_code', { code: '482913' }),
    );
    await provider.send(
      '+37120000001',
      formatMessage('lv', 'sms.driver_assigned', {
        driver: 'Jānis',
        plate: 'AB-1234',
        eta: '5',
        link: 'https://t.example.com/abc',
      }),
    );

    // THE ENCODING PIN. A hardcoded `unicode: true` passes every other case in
    // this file and fails only here — and it would make the scorecard's OTP
    // row compare a route difference with an encoding difference mixed in,
    // because Twilio and BudgetSMS both send this same ASCII body as GSM-7.
    const flags = calls.map(
      (c) =>
        (JSON.parse(c.init.body as string) as { unicode: boolean }).unicode,
    );
    expect(flags).toEqual([false, true]);
  });

  it('wires the request timeout (edge)', async () => {
    const { fn, calls } = fakeFetch(200, ACCEPTED);

    await new BulkGateSmsProvider(CONFIG, fn).send('+37120000001', 'x');

    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects leak-free on a BulkGate 400 whose error text echoes the phone (failure)', async () => {
    const { fn } = fakeFetch(
      400,
      JSON.stringify({
        type: 'invalid_phone_number',
        code: 400,
        error: 'Invalid phone number +37120000001',
        detail: null,
      }),
    );

    const err = await new BulkGateSmsProvider(CONFIG, fn)
      .send('+37120000001', 'secret body 123456')
      .then(
        () => {
          throw new Error('expected send() to reject');
        },
        (e: Error) => e,
      );

    // The leak pin: auth.service.ts logs err.message VERBATIM, so it must
    // carry neither BulkGate's `error`/`detail` text (which names the phone)
    // nor the SMS body.
    expect(err.message).toBe('bulkgate_error_invalid_phone_number');
    expect(err.message).not.toContain('+37120000001');
    expect(err.message).not.toContain('secret body');
  });

  it('falls back to the HTTP status on a non-JSON error body (failure)', async () => {
    const { fn } = fakeFetch(502, '<html>502</html>');

    await expect(
      new BulkGateSmsProvider(CONFIG, fn).send('+37120000001', 'x'),
    ).rejects.toThrow('bulkgate_error_502');
  });
});
