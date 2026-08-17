import { Logger } from '@nestjs/common';
import { StubTelephonyProvider } from './stub-telephony.provider';

describe('StubTelephonyProvider', () => {
  const telephony = new StubTelephonyProvider();

  it('resolves a dial and logs the stubbed event (expected)', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    await expect(telephony.dial('+37129999000')).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'telephony.dial.stubbed',
        phoneLength: 12,
      }),
    );
    log.mockRestore();
  });

  it('never puts the caller number in the log line (edge)', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    await telephony.dial('+37129999000');

    expect(JSON.stringify(log.mock.calls)).not.toContain('37129999000');
    log.mockRestore();
  });

  it('reports no active inbound call — there is no gateway (failure)', async () => {
    await expect(telephony.currentCaller()).resolves.toBeNull();
  });
});
