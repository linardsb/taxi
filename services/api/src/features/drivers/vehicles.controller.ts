import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  vehicleCreateSchema,
  vehicleUpdateSchema,
  type JwtClaims,
  type Vehicle,
  type VehicleCreate,
  type VehicleUpdate,
} from '@taxi/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../auth';
import { VehiclesService } from './vehicles.service';

/** Validates `:id` here so a non-UUID is a 400, not a Postgres "invalid input syntax" 500. */
const vehicleIdSchema = z.string().uuid();

/** A driver's own cars. Ownership comes from the JWT; the path never names a driver. */
@Controller('drivers/me/vehicles')
@Roles('driver')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  list(@CurrentUser() user: JwtClaims): Promise<Vehicle[]> {
    return this.vehicles.list(user.sub);
  }

  // 201 is the Nest default for @Post and correct here — this creates a resource.
  @Post()
  create(
    @CurrentUser() user: JwtClaims,
    @Body(new ZodValidationPipe(vehicleCreateSchema)) body: VehicleCreate,
  ): Promise<Vehicle> {
    return this.vehicles.create(user.sub, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtClaims,
    @Param('id', new ZodValidationPipe(vehicleIdSchema)) id: string,
    @Body(new ZodValidationPipe(vehicleUpdateSchema)) body: VehicleUpdate,
  ): Promise<Vehicle> {
    return this.vehicles.update(user.sub, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: JwtClaims,
    @Param('id', new ZodValidationPipe(vehicleIdSchema)) id: string,
  ): Promise<void> {
    return this.vehicles.remove(user.sub, id);
  }
}
