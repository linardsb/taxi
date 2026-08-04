import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { jwtClaimsSchema, type JwtClaims, type UserRole } from '@taxi/shared';

@Injectable()
export class AuthTokenService {
  constructor(private readonly jwt: JwtService) {}

  /**
   * `expiresAt` is derived from the token's own `exp` rather than recomputed
   * from JWT_EXPIRES_IN — that is a string like '30d' we would have to parse
   * ourselves, and the two could drift.
   */
  async issue(user: { id: string; role: UserRole }): Promise<{
    accessToken: string;
    expiresAt: string;
  }> {
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      role: user.role,
    });
    const claims = jwtClaimsSchema.parse(this.jwt.decode(accessToken));
    return {
      accessToken,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
    };
  }

  /**
   * Throws UnauthorizedException on any bad/expired/malformed token. The
   * decoded payload is parsed, not trusted: verifyAsync returns `any`, and a
   * token signed by an earlier build could carry a role that no longer exists.
   */
  async verify(token: string): Promise<JwtClaims> {
    try {
      return jwtClaimsSchema.parse(await this.jwt.verifyAsync(token));
    } catch {
      throw new UnauthorizedException('invalid_token');
    }
  }
}
