import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { JwtClaims, UserRole } from '@taxi/shared';
import { RolesGuard } from './roles.guard';

/**
 * The contradictory combination this defends against — `@Public()` with
 * `@Roles()` on a non-HTTP handler — is not reachable today, because
 * JwtAuthGuard refuses non-HTTP contexts first. But its `@Public()` early
 * return precedes that check, so the hole opens the moment someone marks a
 * socket handler public. A crash there would be a 500 where the answer is
 * "no".
 */
const ctxOf = (type: 'http' | 'ws', user?: JwtClaims): ExecutionContext =>
  ({
    getType: () => type,
    getHandler: () => undefined,
    getClass: () => undefined,
    // A ws context's switchToHttp() yields no request at all — reading `.user`
    // off it is the TypeError this guard used to throw.
    switchToHttp: () =>
      type === 'http'
        ? { getRequest: () => ({ user }) }
        : { getRequest: () => undefined },
  }) as unknown as ExecutionContext;

const reflectorFor = (roles?: UserRole[]) =>
  ({ getAllAndOverride: () => roles }) as unknown as Reflector;

const claims = (role: UserRole): JwtClaims => ({
  sub: '8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f',
  role,
  iat: 0,
  exp: 2 ** 31,
});

describe('RolesGuard', () => {
  it('admits a matching role over HTTP (expected)', () => {
    const guard = new RolesGuard(reflectorFor(['admin']));

    expect(guard.canActivate(ctxOf('http', claims('admin')))).toBe(true);
  });

  it('refuses a non-HTTP context instead of crashing on it (failure)', () => {
    const guard = new RolesGuard(reflectorFor(['admin']));

    // Fail closed: a role requirement this guard cannot evaluate is one that
    // is not met. Specifically ForbiddenException — a TypeError would be a 500.
    expect(() => guard.canActivate(ctxOf('ws', claims('admin')))).toThrow(
      ForbiddenException,
    );
  });

  it('still waves through a handler with no @Roles() metadata (edge)', () => {
    const guard = new RolesGuard(reflectorFor(undefined));

    // No metadata means "any authenticated user" — the context check must not
    // turn that into a refusal, or every unannotated socket handler breaks.
    expect(guard.canActivate(ctxOf('ws'))).toBe(true);
  });

  it('refuses a role that is not in the list (failure)', () => {
    const guard = new RolesGuard(reflectorFor(['admin']));

    expect(() => guard.canActivate(ctxOf('http', claims('rider')))).toThrow(
      ForbiddenException,
    );
  });
});
