'use client';

import type { UserRole } from '@taxi/shared';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSession } from './use-session';

/**
 * Client-side role gate for a route group. UX ONLY — localStorage tokens are
 * invisible to edge middleware, so there is deliberately no middleware.ts;
 * real enforcement is the API's `@Roles` guard on every read the gated pages
 * make (see apps/dispatch/CLAUDE.md).
 */
export function RequireRole({
  roles,
  children,
}: Readonly<{ roles: readonly UserRole[]; children: React.ReactNode }>) {
  const router = useRouter();
  const session = useSession();
  const allowed = session != null && roles.includes(session.user.role);

  useEffect(() => {
    // undefined = localStorage not read yet; redirecting then would bounce
    // every hard refresh through /login.
    if (session === undefined) return;
    if (!allowed) router.replace('/login');
  }, [session, allowed, router]);

  if (!allowed) return null; // reading or redirecting — render nothing gated
  return <>{children}</>;
}
