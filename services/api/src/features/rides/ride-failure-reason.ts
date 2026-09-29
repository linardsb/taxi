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
