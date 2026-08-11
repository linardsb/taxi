import { Controller, Get, Param } from '@nestjs/common';
import type { TrackingView } from '@taxi/shared';
import { Public } from '../../auth';
import { TrackingService } from './tracking.service';

/**
 * The no-login tracking read (#63). `@Public()` and NOTHING else — no
 * `@Roles`, no `@CurrentUser`: the token in the path IS the whole
 * authorization, which is why it is 128 random bits and why the service
 * never logs it in full.
 */
@Controller()
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Public()
  @Get('track/:token')
  view(@Param('token') token: string): Promise<TrackingView> {
    return this.tracking.view(token);
  }
}
