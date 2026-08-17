import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  customerUpsertBodySchema,
  phoneSchema,
  type CallerLookup,
  type Customer,
  type CustomerUpsertBody,
  type JwtClaims,
} from '@taxi/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth';
import { CustomersService, type VenueEntry } from './customers.service';

/**
 * Normalized to E.164 by the SAME schema `otpRequestSchema` uses. Two
 * normalizations would make a caller invisible to their own record: the number
 * their OTP created and the number Dina looked up would differ by a space.
 */
const lookupQuerySchema = z.object({ phone: phoneSchema });

/**
 * Caller-ID lookup and the venue book (#19). Dispatcher/admin only, per ROUTE —
 * every response here is another person's PII, and a driver reading it would be
 * reading their passengers' address history.
 */
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get('lookup')
  @Roles('dispatcher', 'admin')
  lookup(
    @CurrentUser() user: JwtClaims,
    @Query(new ZodValidationPipe(lookupQuerySchema))
    query: { phone: string },
  ): Promise<CallerLookup | null> {
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
}
