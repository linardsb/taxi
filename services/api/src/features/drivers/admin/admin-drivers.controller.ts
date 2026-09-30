import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  Query,
} from '@nestjs/common';
import {
  adminDriverListQuerySchema,
  adminDriverUpdateSchema,
  driverApprovalUpdateSchema,
  type AdminDriverDetail,
  type AdminDriverListQuery,
  type AdminDriverSummary,
  type AdminDriverUpdate,
  type DriverApprovalUpdate,
  type JwtClaims,
} from '@taxi/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../../auth';
import { AdminDriversService } from './admin-drivers.service';

/** Validates `:id` so a non-UUID is a 400, not a Postgres "invalid input syntax" 500. */
const driverIdSchema = z.string().uuid();

/**
 * Driver review (#20). Its own `admin/drivers` prefix, so the `:id` routes
 * cannot shadow `drivers/me`. `@Roles('admin')` per handler: a dispatcher has
 * every other console route, and none of these.
 */
@Controller('admin/drivers')
export class AdminDriversController {
  constructor(private readonly admin: AdminDriversService) {}

  @Get()
  @Roles('admin')
  list(
    @Query(new ZodValidationPipe(adminDriverListQuerySchema))
    query: AdminDriverListQuery,
  ): Promise<AdminDriverSummary[]> {
    return this.admin.list(query.approval);
  }

  @Get(':id')
  @Roles('admin')
  detail(
    @Param('id', new ZodValidationPipe(driverIdSchema)) id: string,
  ): Promise<AdminDriverDetail> {
    return this.admin.detail(id);
  }

  @Patch(':id')
  @Roles('admin')
  update(
    @Param('id', new ZodValidationPipe(driverIdSchema)) id: string,
    @Body(new ZodValidationPipe(adminDriverUpdateSchema))
    body: AdminDriverUpdate,
  ): Promise<AdminDriverDetail> {
    return this.admin.update(id, body);
  }

  @Put(':id/approval')
  @Roles('admin')
  setApproval(
    @CurrentUser() user: JwtClaims,
    @Param('id', new ZodValidationPipe(driverIdSchema)) id: string,
    @Body(new ZodValidationPipe(driverApprovalUpdateSchema))
    body: DriverApprovalUpdate,
  ): Promise<AdminDriverDetail> {
    return this.admin.setApproval(user.sub, id, body.status);
  }
}
