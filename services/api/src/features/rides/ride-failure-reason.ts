import { InternalServerErrorException } from '@nestjs/common';
import { DrizzleQueryError } from 'drizzle-orm';

/**
 * The `reason` a failed ride request may log. Drizzle's `DrizzleQueryError`
 * puts every bound parameter in its message (`params: …`), and the ride insert
 * binds Dina's note (#303), the pickup PIN and the tracking token. So a query
 * failure is reduced to its SQLSTATE; any other error keeps its message.
 */
export function rideFailureReason(error: unknown): string {
  if (error instanceof DrizzleQueryError) {
    const code = (error.cause as { code?: unknown } | undefined)?.code;
    return typeof code === 'string' ? `query_failed:${code}` : 'query_failed';
  }
  return error instanceof Error ? error.message : 'unknown';
}

/**
 * What a failed ride request rethrows (PR #304 H1). A `DrizzleQueryError`
 * reaching Nest's default handler is logged whole, params and all, so it is
 * swapped for a bare 500 with no `cause`: Nest never logs an `HttpException`,
 * and `ride.request.failed` has already recorded the SQLSTATE. Any other error
 * is rethrown unchanged, so a 4xx or 503 from the quote keeps its status.
 */
export function rideFailureToThrow(error: unknown): unknown {
  return error instanceof DrizzleQueryError
    ? new InternalServerErrorException()
    : error;
}
