import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
} from '@nestjs/common';
import {
  adminVehicleUpdateSchema,
  type AdminVehicleUpdate,
  type Vehicle,
} from '@taxi/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../../../common/zod-validation.pipe';
import { Roles } from '../../auth';
import { AdminDriversService } from './admin-drivers.service';

const vehicleIdSchema = z.string().uuid();

/** Any driver's car, for the admin (#20) — the only writer of `category`. */
@Controller('admin/vehicles')
export class AdminVehiclesController {
  constructor(private readonly admin: AdminDriversService) {}

  @Patch(':id')
  @Roles('admin')
  update(
    @Param('id', new ZodValidationPipe(vehicleIdSchema)) id: string,
    @Body(new ZodValidationPipe(adminVehicleUpdateSchema))
    body: AdminVehicleUpdate,
  ): Promise<Vehicle> {
    return this.admin.updateVehicle(id, body);
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(204)
  remove(
    @Param('id', new ZodValidationPipe(vehicleIdSchema)) id: string,
  ): Promise<void> {
    return this.admin.removeVehicle(id);
  }
}
