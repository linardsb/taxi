import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Query,
} from '@nestjs/common';
import {
  customerUpsertBodySchema,
  phoneSchema,
  type CallerLookup,
  type Customer,
  type CustomerUpsertBody,
  type JwtClaims,
  type VenueEntry,
} from '@taxi/shared';
import { z } from 'zod';
import { KV_STORE, type KeyValueStore } from '../../common/kv/kv.store';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth';
import {
  CUSTOMER_LOOKUP_MAX_PER_WINDOW,
  CUSTOMER_LOOKUP_WINDOW_SECONDS,
  customerLookupRateKey,
} from './customers.policy';
import { CustomersService } from './customers.service';

/**
 * VALIDATED against the same schema `otpRequestSchema` uses — not normalized.
 * `phoneSchema` is a bare E.164 regex with no `.transform()`, so it admits
 * exactly one spelling and rejects the rest.
 *
 * That is what keeps two spellings from creating two identities, and it is why
 * normalization belongs to the CONSOLE (`booking-draft.normalizePhone`) rather
 * than here: widening this schema would widen `otpRequestSchema` and every auth
 * consumer with it.
 */
const lookupQuerySchema = z.object({ phone: phoneSchema });

/**
 * Caller-ID lookup and the venue book (#19). Dispatcher/admin only, per ROUTE —
 * every response here is another person's PII, and a driver reading it would be
 * reading their passengers' address history.
 */
@Controller('customers')
export class CustomersController {
  private readonly logger = new Logger(CustomersController.name);

  constructor(
    private readonly customers: CustomersService,
    @Inject(KV_STORE) private readonly kv: KeyValueStore,
  ) {}

  @Get('lookup')
  @Roles('dispatcher', 'admin')
  async lookup(
    @CurrentUser() user: JwtClaims,
    @Query(new ZodValidationPipe(lookupQuerySchema))
    query: { phone: string },
  ): Promise<CallerLookup | null> {
    await this.assertWithinRateLimit(user.sub);
    return this.customers.lookup(user.sub, query.phone);
  }

  @Get('venues')
  @Roles('dispatcher', 'admin')
  venues(): Promise<VenueEntry[]> {
    return this.customers.listVenues();
  }

  /**
   * Naming a caller or flagging a venue. One route rather than POST + PATCH:
   * the phone IS the key, so "create" and "update" are the same operation to
   * every caller of it, and two routes would only add a decision Dina has to
   * make mid-call.
   */
  @Post()
  @Roles('dispatcher', 'admin')
  upsert(
    @Body(new ZodValidationPipe(customerUpsertBodySchema))
    body: CustomerUpsertBody,
  ): Promise<Customer> {
    return this.customers.upsert(body);
  }

  /**
   * MIRRORS `AddressSearchController.assertWithinRateLimit`, including the 429
   * shape and the `Math.max(1, …)` floor — a `retryAfterSeconds` of 0 reads as
   * "retry now" to the client that was just throttled.
   *
   * On the LOOKUP only. `POST /customers` writes a row Dina meant to write, and
   * `GET /customers/venues` returns records she filed herself; neither is an
   * oracle over numbers she has not seen.
   */
  private async assertWithinRateLimit(dispatcherId: string): Promise<void> {
    const key = customerLookupRateKey(dispatcherId);
    const attempts = await this.kv.incrWithTtl(
      key,
      CUSTOMER_LOOKUP_WINDOW_SECONDS,
    );
    if (attempts <= CUSTOMER_LOOKUP_MAX_PER_WINDOW) return;

    const retryAfterSeconds = Math.max(1, await this.kv.ttl(key));
    this.logger.warn({
      event: 'dispatch.customers.lookup_throttled',
      dispatcherId,
      attempts,
      at: new Date().toISOString(),
    });
    throw new HttpException(
      { message: 'too_many_requests', retryAfterSeconds },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
