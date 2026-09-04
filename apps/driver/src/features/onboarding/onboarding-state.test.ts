import { nextRoute } from './onboarding-state';

const RIDE = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';

describe('nextRoute', () => {
  it('sends a driver with no vehicle through onboarding (expected)', () => {
    expect(nextRoute({ signedIn: true, vehicles: 0, activeRideId: null })).toBe(
      '/onboarding/profile',
    );
  });

  it('sends a driver with a vehicle home (edge)', () => {
    expect(nextRoute({ signedIn: true, vehicles: 1, activeRideId: null })).toBe(
      '/home',
    );
    expect(nextRoute({ signedIn: true, vehicles: 3, activeRideId: null })).toBe(
      '/home',
    );
  });

  it('a driver mid-ride lands on the ride, even with zero vehicles — the ride exists, the car was deleted (#15, edge)', () => {
    expect(nextRoute({ signedIn: true, vehicles: 0, activeRideId: RIDE })).toBe(
      '/active-ride',
    );
    expect(nextRoute({ signedIn: true, vehicles: 2, activeRideId: RIDE })).toBe(
      '/active-ride',
    );
  });

  it('sends a signed-out driver to login whatever the vehicle count or ride (failure)', () => {
    expect(
      nextRoute({ signedIn: false, vehicles: 2, activeRideId: null }),
    ).toBe('/login');
    expect(
      nextRoute({ signedIn: false, vehicles: 0, activeRideId: RIDE }),
    ).toBe('/login');
  });
});
