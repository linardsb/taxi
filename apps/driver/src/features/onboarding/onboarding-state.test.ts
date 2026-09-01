import { nextRoute } from './onboarding-state';

describe('nextRoute', () => {
  it('sends a driver with no vehicle through onboarding (expected)', () => {
    expect(nextRoute({ signedIn: true, vehicles: 0 })).toBe(
      '/onboarding/profile',
    );
  });

  it('sends a driver with a vehicle home (edge)', () => {
    expect(nextRoute({ signedIn: true, vehicles: 1 })).toBe('/home');
    expect(nextRoute({ signedIn: true, vehicles: 3 })).toBe('/home');
  });

  it('sends a signed-out driver to login whatever the vehicle count (failure)', () => {
    expect(nextRoute({ signedIn: false, vehicles: 2 })).toBe('/login');
  });
});
