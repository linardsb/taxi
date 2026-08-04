import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtClaims } from '@taxi/shared';
import { AuthTokenService } from '../auth-token.service';
import { IS_PUBLIC } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AuthTokenService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    // WS/RPC contexts have no HTTP request: switchToHttp().getRequest() would
    // return undefined and this guard would wave the call through. Sockets are
    // authenticated at the handshake (features/realtime) — anything else is
    // refused outright rather than silently allowed. #8 adds the first
    // @SubscribeMessage handler; it must authorize from socket.data.user.
    if (ctx.getType() !== 'http')
      throw new UnauthorizedException('unsupported_context');

    const request = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      user?: JwtClaims;
    }>();
    const header = request.headers.authorization;
    const raw = Array.isArray(header) ? header[0] : header;
    const [scheme, token] = raw?.split(' ') ?? [];
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('missing_token');
    }

    request.user = await this.tokens.verify(token);
    return true;
  }
}
