export type GateRoute = '/login' | '/onboarding/profile' | '/home';

/**
 * The router gate's one decision (D13). The only server-enforced prerequisite
 * for going online is a vehicle (`vehicle_required`), so "has a vehicle" is
 * the whole onboarding test; the profile step is reached on the way there.
 */
export function nextRoute(input: {
  signedIn: boolean;
  vehicles: number;
}): GateRoute {
  if (!input.signedIn) return '/login';
  return input.vehicles === 0 ? '/onboarding/profile' : '/home';
}
