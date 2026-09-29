import {
  HttpException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DrizzleQueryError } from 'drizzle-orm';
import { rideFailureReason, rideFailureToThrow } from './ride-failure-reason';

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

describe('rideFailureToThrow (PR #304 H1)', () => {
  it('swaps a failed query for a bare 500 that carries no params (expected)', () => {
    const error = new DrizzleQueryError('insert …', [NOTE], undefined);
    const thrown = rideFailureToThrow(error);

    expect(thrown).toBeInstanceOf(InternalServerErrorException);
    expect((thrown as HttpException).cause).toBeUndefined();
    expect(
      JSON.stringify((thrown as HttpException).getResponse()),
    ).not.toContain(NOTE);
  });

  it('rethrows an HttpException unchanged, so its status survives (edge)', () => {
    const unavailable = new ServiceUnavailableException('maps_unavailable');
    expect(rideFailureToThrow(unavailable)).toBe(unavailable);
  });

  it('rethrows any other error unchanged (failure)', () => {
    const error = new Error('maps down');
    expect(rideFailureToThrow(error)).toBe(error);
    expect(rideFailureToThrow('boom')).toBe('boom');
  });
});
