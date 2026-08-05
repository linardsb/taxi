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

    // `switchToHttp()` on a ws/rpc context yields undefined, and reading
    // `.user` off it is a TypeError, not a refusal. Safe today only because
    // JwtAuthGuard rejects non-HTTP first — but its @Public() early return
    // comes BEFORE that check, so a @Public() + @Roles() socket handler would
    // arrive here and crash. Fail closed instead: a role requirement this
    // guard cannot evaluate is a role requirement that is not met.
    if (ctx.getType() !== 'http')
      throw new ForbiddenException('insufficient_role');

    const user = ctx.switchToHttp().getRequest<{ user?: JwtClaims }>().user;
    if (!user || !roles.includes(user.role))
      throw new ForbiddenException('insufficient_role');
    return true;
  }
}
