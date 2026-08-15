import { describe, expect, it } from 'vitest';
import { LANGUAGES } from '../src/enums';
import { MESSAGES, formatMessage, type MessageKey } from '../src/i18n';

const KEYS = Object.keys(MESSAGES.lv) as MessageKey[];

function placeholdersOf(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
}

describe('MESSAGES catalog', () => {
  it('every key exists in every language (expected)', () => {
    for (const lang of LANGUAGES) {
      expect(Object.keys(MESSAGES[lang]).sort()).toEqual([...KEYS].sort());
    }
  });

  it('placeholder sets are identical across languages per key (expected)', () => {
    for (const key of KEYS) {
      const reference = placeholdersOf(MESSAGES.lv[key]);
      for (const lang of LANGUAGES) {
        expect(placeholdersOf(MESSAGES[lang][key]), `${lang}:${key}`).toEqual(
          reference,
        );
      }
    }
  });

  it('no catalog entry is empty (edge)', () => {
    for (const lang of LANGUAGES) {
      for (const key of KEYS) {
        expect(MESSAGES[lang][key].length, `${lang}:${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('the three connection-pill states read distinctly in every language (edge)', () => {
    // The pill is the console's truthfulness guarantee (#18) — two states
    // sharing a string would make "reconnecting" indistinguishable from
    // "live" or "offline" to Dina.
    for (const lang of LANGUAGES) {
      const states = [
        MESSAGES[lang]['console.live'],
        MESSAGES[lang]['console.reconnecting'],
        MESSAGES[lang]['console.offline'],
      ];
      expect(new Set(states).size, lang).toBe(3);
    }
  });
});

describe('formatMessage', () => {
  it('interpolates every placeholder (expected)', () => {
    const body = formatMessage('lv', 'sms.driver_assigned', {
      driver: 'Jānis',
      plate: 'AB-1234',
      eta: 4,
      link: 'https://t.example/abc',
    });
    expect(body).toBe(
      'Jūsu šoferis Jānis, AB-1234, būs pēc ~4 min. Sekojiet līdzi: https://t.example/abc',
    );
    expect(body).not.toContain('{');
  });

  it('leaves an unsupplied placeholder verbatim instead of swallowing it (failure)', () => {
    expect(formatMessage('en', 'sms.booking_confirmed_phone')).toContain(
      '{link}',
    );
  });

  it('a message without placeholders passes through untouched (edge)', () => {
    expect(formatMessage('ru', 'sms.booking_confirmed')).toBe(
      'Ваше такси забронировано.',
    );
  });
});
