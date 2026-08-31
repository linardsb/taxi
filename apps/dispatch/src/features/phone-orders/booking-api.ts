'use client';

import {
  addressPointSchema,
  addressSuggestionsSchema,
  apiErrorBodySchema,
  callerLookupSchema,
  venueEntrySchema,
  type AddressPoint,
  type AddressSuggestion,
  type CallerLookup,
  type DispatcherBookingBody,
  type VenueEntry,
} from '@taxi/shared';
import { z } from 'zod';
import { apiUrl, loadSession } from '@/features/auth';

/**
 * The five calls the booking form makes, in one place.
 *
 * Split out of the hook rather than inlined like `use-assign.ts`: this form
 * talks to five endpoints across three slices, and the 500-line cap on shipped
 * source is a real constraint on a component tree this size. Every response is
 * PARSED through its shared schema — the same rule the board applies to its
 * frame, and the reason a contract drift fails loudly instead of rendering
 * `undefined` at a dispatcher mid-call.
 */

/** Thrown for 401/403 so the hook can drop the session and bounce to /login. */
export class AuthExpiredError extends Error {
  constructor() {
    super('auth_expired');
    this.name = 'AuthExpiredError';
  }
}

/**
 * Carries the api's error CODE so the caller can map it to a message key, and
 * its `retryAfterSeconds` where the api sent one.
 *
 * The retry value is READ, never assumed: `RIDE_REQUEST_WINDOW_SECONDS` is
 * 600, so a hardcoded "60 s" would tell a throttled dispatcher to try again
 * ten times too early — the same defect #105 clamped on the tracking page.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string | undefined,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(code ?? 'api_error');
    this.name = 'ApiError';
  }
}

async function apiErrorOf(res: Response): Promise<ApiError> {
  try {
    // The shared envelope — the same schema the api types its producers
    // with. A looser hand-rolled twin here kept parsing a shape the api
    // could stop sending (review F26).
    const parsed = apiErrorBodySchema.safeParse(await res.json());
    if (parsed.success) {
      return new ApiError(
        parsed.data.message,
        parsed.data.retryAfterSeconds ?? null,
      );
    }
  } catch {
    /* a body-less error is ordinary; the generic key covers it */
  }
  return new ApiError(undefined);
}

async function authedFetch(
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const session = loadSession();
  if (session === null) throw new AuthExpiredError();

  const res = await fetch(`${apiUrl()}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${session.accessToken}`,
    },
    cache: 'no-store',
  });
  if (res.status === 401 || res.status === 403) throw new AuthExpiredError();
  if (!res.ok) throw await apiErrorOf(res);

  // An EMPTY BODY arrives as `null`, never as a rejected promise. Nest answers
  // a `null` return with a zero-length body rather than the JSON literal
  // `null`, and `res.json()` rejects on that — which turned the ORDINARY answer
  // from `/customers/lookup` (a first-time caller) into a failed lookup, and
  // made the panel's "new caller" state unreachable in production.
  const body = await res.text();
  return body === '' ? null : (JSON.parse(body) as unknown);
}

export function searchAddress(
  query: string,
  session: string,
): Promise<AddressSuggestion[]> {
  const params = new URLSearchParams({ q: query, session });
  return authedFetch(`/geo/address-search?${params.toString()}`).then((body) =>
    addressSuggestionsSchema.parse(body),
  );
}

export function resolvePlace(
  placeId: string,
  session: string,
): Promise<AddressPoint | null> {
  return authedFetch(`/geo/places/${encodeURIComponent(placeId)}/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ session }),
  })
    .then((body) => addressPointSchema.parse(body))
    .catch((error: unknown) => {
      // A 404 means the provider forgot the place id — a stale saved place,
      // not a failure. The field re-searches; everything else propagates.
      if (error instanceof ApiError && error.code === 'place_not_found') {
        return null;
      }
      throw error;
    });
}

export function lookupCaller(phone: string): Promise<CallerLookup | null> {
  const params = new URLSearchParams({ phone });
  return authedFetch(`/customers/lookup?${params.toString()}`).then((body) =>
    body === null ? null : callerLookupSchema.parse(body),
  );
}

export function listVenues(): Promise<VenueEntry[]> {
  return authedFetch('/customers/venues').then((body) =>
    z.array(venueEntrySchema).parse(body),
  );
}

/**
 * `Idempotency-Key` is the header the api REQUIRES, and the draft mints it
 * once. That pairing is what makes a retry after a timeout replay the first
 * ride instead of dispatching a second car.
 */
export function book(
  body: DispatcherBookingBody,
  idempotencyKey: string,
): Promise<{ rideId: string }> {
  return authedFetch('/dispatch/bookings', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify(body),
  }).then((response) =>
    z
      .object({ ride: z.object({ id: z.string() }) })
      .transform((parsed) => ({ rideId: parsed.ride.id }))
      .parse(response),
  );
}
