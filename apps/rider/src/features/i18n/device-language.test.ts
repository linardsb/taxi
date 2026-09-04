import { deviceLanguage } from './device-language';

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
