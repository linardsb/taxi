export type GateRoute =
  '/login' | '/onboarding/profile' | '/home' | '/active-ride';

/**
 * The router gate's one decision (D13). A ride in progress outranks
 * everything else a signed-in driver could be sent to (#15): the ride exists
 * whether or not the car still does. Otherwise the only server-enforced
 * prerequisite for going online is a vehicle (`vehicle_required`), so "has a
 * vehicle" is the whole onboarding test; the profile step is reached on the
 * way there.
 */
export function nextRoute(input: {
  signedIn: boolean;
  vehicles: number;
  activeRideId: string | null;
}): GateRoute {
  if (!input.signedIn) return '/login';
  if (input.activeRideId) return '/active-ride';
  return input.vehicles === 0 ? '/onboarding/profile' : '/home';
}
