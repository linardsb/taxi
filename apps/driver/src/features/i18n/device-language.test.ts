import { deviceLanguage } from './device-language';
import { errorMessageKey } from './error-key';

describe('deviceLanguage', () => {
  it('reads a Russian phone as ru (expected)', () => {
    expect(deviceLanguage([{ languageCode: 'ru' }])).toBe('ru');
  });

  it('falls through to the second locale when the first is unknown (edge)', () => {
    expect(
      deviceLanguage([{ languageCode: 'de' }, { languageCode: 'en' }]),
    ).toBe('en');
  });

  it('defaults to lv on no locales, a null code, or nothing the catalog speaks (failure)', () => {
    expect(deviceLanguage([])).toBe('lv');
    expect(deviceLanguage([{ languageCode: null }])).toBe('lv');
    expect(deviceLanguage([{ languageCode: 'de' }])).toBe('lv');
  });

  it('reads the mocked expo-localization by default (edge — the jest setup pins lv)', () => {
    expect(deviceLanguage()).toBe('lv');
  });
});

describe('errorMessageKey', () => {
  it("maps the api's codes to catalog keys and unknown codes to generic", () => {
    expect(errorMessageKey('vehicle_required')).toBe(
      'driver.error.vehicle_required',
    );
    expect(errorMessageKey('something_new')).toBe('driver.error.generic');
    // A prototype name must not sneak through as a "key".
    expect(errorMessageKey('constructor')).toBe('driver.error.generic');
  });
});
