import { ForbiddenException } from '@nestjs/common';
import type { JwtClaims, UserRole } from '@taxi/shared';
import { SettlementController } from './settlement.controller';
import type { SettlementService } from './settlement.service';

const RIDE_ID = 'r0000000-0000-4000-8000-000000000001';
const USER_ID = 'd0000000-0000-4000-8000-000000000001';

const claims = (role: UserRole): JwtClaims => ({
  sub: USER_ID,
  role,
  iat: 0,
  exp: 0,
});

const build = () => {
  const settled: { rideId: string; actor: string; actorId: string }[] = [];
  const settlement = {
    settle: (input: { rideId: string; actor: string; actorId: string }) => {
      settled.push(input);
      return Promise.resolve({ ride: { id: input.rideId } });
    },
  } as unknown as SettlementService;

  return { settled, controller: new SettlementController(settlement) };
};

/**
 * The mapping layer only — `RolesGuard` is tested generically by its own spec,
 * and `payments.integration.spec.ts` pins the route's decorator list at HTTP
 * level, all four roles: `rider` refused with `insufficient_role`, `driver` on
 * every other settle in the file, and `dispatcher`/`admin` each settling a ride
 * they do not own. What is left, and what this file covers, is where a role
 * lands ONCE it gets past the guard.
 */
describe('SettlementController.settle role mapping', () => {
  it.each([
    ['driver', 'driver'],
    ['dispatcher', 'dispatcher'],
    // NOT collapsed into `dispatcher`: the settlement log is an audit trail that
    // should say which of them actually acted.
    ['admin', 'admin'],
  ] as [UserRole, string][])(
    'passes a %s through as actor %s (expected)',
    async (role, actor) => {
      const { controller, settled } = build();

      await controller.settle(claims(role), RIDE_ID);

      expect(settled).toEqual([{ rideId: RIDE_ID, actor, actorId: USER_ID }]);
    },
  );

  it('refuses a rider instead of silently granting dispatcher override (failure)', () => {
    // THE REGRESSION THIS FILE EXISTS FOR. The ternary chain this replaced ended
    // in `: 'dispatcher'`, so a rider reaching here — which is one edit to
    // `@Roles` away, `rider` being the only role addable — became the actor that
    // BYPASSES the ownership check in `SettlementService.settle`. Full override
    // on any ride in the platform, with no compile error at any point.
    const { controller, settled } = build();

    // SYNCHRONOUS, not `rejects`: `settle` is not `async`, so the refusal throws
    // during the call rather than on the promise it would otherwise return —
    // which is the point, since nothing downstream ever runs.
    expect(() => controller.settle(claims('rider'), RIDE_ID)).toThrow(
      ForbiddenException,
    );
    expect(settled).toEqual([]);
  });

  it('refuses a role outside USER_ROLES rather than passing undefined on (failure)', () => {
    // The `undefined` arm, which `actor === null` used to let through. An
    // unmapped role indexes `SETTLEMENT_ACTORS` to `undefined`, and
    // `settle({ actor: undefined })` fails `input.actor === 'driver'` — SKIPPING
    // the ownership check, the exact override the `null` arm exists to refuse.
    //
    // Forged past the type system on purpose: `jwtClaimsSchema.parse` in the
    // auth slice makes this unreachable through a real token. That is the point
    // — the docblock above claims this route fails closed, and until this test
    // the property lived in another slice's zod enum, not here.
    const { controller, settled } = build();
    const unmapped = { sub: USER_ID, role: 'auditor', iat: 0, exp: 0 };

    expect(() =>
      controller.settle(unmapped as unknown as JwtClaims, RIDE_ID),
    ).toThrow(ForbiddenException);
    expect(settled).toEqual([]);
  });
});
