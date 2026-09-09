import { Linking } from 'react-native';
import {
  canOpenWaze,
  googleMapsLink,
  openNavigation,
  wazeLink,
} from './nav-links';

const PICKUP = { lat: 56.9496, lng: 24.1052 };

describe('nav links (#15)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('builds the platform scheme with the universal URL as fallback (expected)', () => {
    expect(googleMapsLink(PICKUP, 'android')).toEqual({
      url: 'google.navigation:q=56.9496,24.1052&mode=d',
      fallback:
        'https://www.google.com/maps/dir/?api=1&destination=56.9496,24.1052&travelmode=driving',
    });
    expect(googleMapsLink(PICKUP, 'ios').url).toBe(
      'comgooglemaps://?daddr=56.9496,24.1052&directionsmode=driving',
    );
    expect(wazeLink(PICKUP).url).toBe(
      'waze://?ll=56.9496,24.1052&navigate=yes',
    );
  });

  it('falls back to the web URL when the scheme is refused, and never throws (failure)', async () => {
    const openURL = jest
      .spyOn(Linking, 'openURL')
      .mockRejectedValueOnce(new Error('no app'))
      .mockResolvedValueOnce(true);

    await expect(
      openNavigation(googleMapsLink(PICKUP, 'ios')),
    ).resolves.toBeUndefined();

    expect(openURL).toHaveBeenNthCalledWith(
      1,
      'comgooglemaps://?daddr=56.9496,24.1052&directionsmode=driving',
    );
    expect(openURL).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('https://www.google.com/maps/dir/'),
    );
  });

  it('offers Waze only when the OS can open its scheme (edge)', async () => {
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValueOnce(false);
    expect(await canOpenWaze(PICKUP)).toBe(false);
    jest
      .spyOn(Linking, 'canOpenURL')
      .mockRejectedValueOnce(new Error('denied'));
    expect(await canOpenWaze(PICKUP)).toBe(false);
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValueOnce(true);
    expect(await canOpenWaze(PICKUP)).toBe(true);
  });
});
