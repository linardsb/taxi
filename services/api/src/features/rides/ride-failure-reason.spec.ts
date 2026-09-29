import { DrizzleQueryError } from 'drizzle-orm';
import { rideFailureReason } from './ride-failure-reason';

const NOTE = 'Ratiņkrēsls, neredzīgs';

describe('rideFailureReason (#303)', () => {
  it('keeps a plain error message (expected)', () => {
    expect(rideFailureReason(new Error('maps down'))).toBe('maps down');
  });

  it('gives "unknown" for a non-Error throw (edge)', () => {
    expect(rideFailureReason('boom')).toBe('unknown');
  });

  it('reduces a failed query to its SQLSTATE, never the bound params (failure)', () => {
    const pg = Object.assign(new Error('value too long'), { code: '22001' });
    const error = new DrizzleQueryError('insert into "rides" …', [NOTE], pg);
    // The premise: drizzle's own message carries the params.
    expect(error.message).toContain(NOTE);

    expect(rideFailureReason(error)).toBe('query_failed:22001');
    expect(
      rideFailureReason(new DrizzleQueryError('insert …', [NOTE], undefined)),
    ).toBe('query_failed');
  });
});
