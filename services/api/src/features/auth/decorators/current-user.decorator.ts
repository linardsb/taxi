import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { JwtClaims } from '@taxi/shared';

/** The claims JwtAuthGuard put on the request. Only valid on guarded routes. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtClaims =>
    ctx.switchToHttp().getRequest<{ user: JwtClaims }>().user,
);
