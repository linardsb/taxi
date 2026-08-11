import { formatMessage } from '@taxi/shared';
import { TwilioSmsProvider } from './twilio-sms.provider';

const CONFIG = {
  accountSid: 'AC' + 'f'.repeat(32),
  authToken: 'auth-token-secret',
  from: '+37167000000',
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

const CREATED = JSON.stringify({
  sid: 'SM00000000000000000000000000000001',
  status: 'queued',
  num_segments: '2',
});

describe('TwilioSmsProvider', () => {
  it('POSTs the account-scoped resource with Basic auth and form fields, and resolves on 201 (expected)', async () => {
    const { fn, calls } = fakeFetch(201, CREATED);

    await new TwilioSmsProvider(CONFIG, fn).send(
      '+37120000001',
      'Jūsu taksometrs ir rezervēts.',
    );

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe(
      `https://api.twilio.com/2010-04-01/Accounts/${CONFIG.accountSid}/Messages.json`,
    );
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from(`${CONFIG.accountSid}:${CONFIG.authToken}`).toString('base64')}`,
    );
    const form = init.body as URLSearchParams;
    expect(form.get('To')).toBe('+37120000001');
    expect(form.get('From')).toBe(CONFIG.from);
    expect(form.get('Body')).toBe('Jūsu taksometrs ir rezervēts.');
  });

  it('sendOtp sends the lv catalog body with the code interpolated (expected)', async () => {
    // lv unconditionally: at request-otp time there may be no user row, so
    // there is no language preference to read.
    const { fn, calls } = fakeFetch(201, CREATED);

    await new TwilioSmsProvider(CONFIG, fn).sendOtp('+37120000001', '123456');

    const form = calls[0]!.init.body as URLSearchParams;
    expect(form.get('Body')).toBe(
      formatMessage('lv', 'sms.otp_code', { code: '123456' }),
    );
    expect(form.get('Body')).toBe('Sakta Cab kods: 123456');
  });

  it('passes an alphanumeric sender through untouched and wires the timeout (edge)', async () => {
    const { fn, calls } = fakeFetch(201, CREATED);

    await new TwilioSmsProvider({ ...CONFIG, from: 'SaktaCab' }, fn).send(
      '+37120000001',
      'x',
    );

    const { init } = calls[0]!;
    expect((init.body as URLSearchParams).get('From')).toBe('SaktaCab');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects leak-free on a Twilio 4xx whose message echoes the phone (failure)', async () => {
    const { fn } = fakeFetch(
      400,
      JSON.stringify({
        code: 21211,
        message: 'Invalid To number +37120000001',
        more_info: 'https://www.twilio.com/docs/errors/21211',
      }),
    );

    const err = await new TwilioSmsProvider(CONFIG, fn)
      .send('+37120000001', 'secret body 123456')
      .then(
        () => {
          throw new Error('expected send() to reject');
        },
        (e: Error) => e,
      );

    // The leak pin: auth.service.ts logs err.message VERBATIM, so it must
    // carry neither Twilio's text (which names the phone) nor the SMS body.
    expect(err.message).toBe('twilio_error_21211');
    expect(err.message).not.toContain('+37120000001');
    expect(err.message).not.toContain('secret body');
  });

  it('falls back to the HTTP status on a non-JSON error body (failure)', async () => {
    const { fn } = fakeFetch(502, '<html>Bad Gateway</html>');

    await expect(
      new TwilioSmsProvider(CONFIG, fn).send('+37120000001', 'x'),
    ).rejects.toThrow('twilio_error_502');
  });
});
