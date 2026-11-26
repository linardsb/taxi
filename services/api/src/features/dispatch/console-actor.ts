import type { JwtClaims } from '@taxi/shared';

/** The console's event actors: dispatcher, or an admin doing a dispatcher's job. */
export type ConsoleActorKind = 'dispatcher' | 'admin';

/** Console routes are `@Roles('dispatcher', 'admin')`; the event records which (#316). */
export function consoleActor(user: JwtClaims): ConsoleActorKind {
  return user.role === 'admin' ? 'admin' : 'dispatcher';
}
