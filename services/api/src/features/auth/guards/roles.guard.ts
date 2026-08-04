import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtClaims, UserRole } from '@taxi/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Registered AFTER JwtAuthGuard, which has already authenticated the request.
 * No @Roles() metadata means "any authenticated user" — not "anyone".
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!roles?.length) return true;

    const user = ctx.switchToHttp().getRequest<{ user?: JwtClaims }>().user;
    if (!user || !roles.includes(user.role))
      throw new ForbiddenException('insufficient_role');
    return true;
  }
}
