import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '../src/enums';
import { TRACKING_PATH_BY_LANGUAGE, trackingLink } from '../src/tracking-link';

const TOKEN = 't'.repeat(16); // the minted length: randomBytes(12), 12 ÷ 3 × 4

describe('trackingLink', () => {
  it('renders host/<lang path>/<token> for every language (expected)', () => {
    expect(trackingLink('https://sakta.lv', TOKEN, 'lv')).toBe(
      `sakta.lv/t/${TOKEN}`,
    );
    expect(trackingLink('https://sakta.lv', TOKEN, 'ru')).toBe(
      `sakta.lv/r/${TOKEN}`,
    );
    expect(trackingLink('https://sakta.lv', TOKEN, 'en')).toBe(
      `sakta.lv/e/${TOKEN}`,
    );
  });

  it('collapses a trailing slash on the base URL (edge)', () => {
    expect(trackingLink('https://sakta.lv/', TOKEN, 'lv')).toBe(
      `sakta.lv/t/${TOKEN}`,
    );
  });

  it('strips an http:// base too, not just https:// (edge)', () => {
    expect(trackingLink('http://localhost:3000', TOKEN, 'ru')).toBe(
      `localhost:3000/r/${TOKEN}`,
    );
  });

  it('emits neither a scheme nor a ?lang= query (failure)', () => {
    for (const language of LANGUAGES) {
      const link = trackingLink('https://sakta.lv', TOKEN, language);
      expect(link, language).not.toContain('http');
      expect(link, language).not.toContain('?lang=');
      expect(link, language).not.toContain('?');
    }
  });

  it('keeps every language path to exactly one distinct character (failure)', () => {
    // The budget's `path` term is 3 characters — `/`, this, `/`. A two-letter
    // path puts RU driver_assigned at 71 against a 70-character segment.
    const paths = Object.values(TRACKING_PATH_BY_LANGUAGE);
    for (const path of paths) expect(path, path).toHaveLength(1);
    expect(new Set(paths).size).toBe(LANGUAGES.length);
  });

  it('renders at host + 1 + 1 + 1 + token, as the budget assumes (expected)', () => {
    const host = 'x'.repeat(10);
    const link = trackingLink(`https://${host}`, TOKEN, 'ru');
    expect(link).toHaveLength(host.length + 1 + 1 + 1 + TOKEN.length);
  });
});
