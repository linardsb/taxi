import { normalisePhone } from './phone-normalise';

describe('normalisePhone', () => {
  it('turns a local mobile with spaces into E.164 (expected)', () => {
    expect(normalisePhone('2 612 3456')).toBe('+37126123456');
  });

  it('keeps an E.164 number and accepts 371… / 00371… (edge)', () => {
    expect(normalisePhone('+37126123456')).toBe('+37126123456');
    expect(normalisePhone('37126123456')).toBe('+37126123456');
    expect(normalisePhone('0037126123456')).toBe('+37126123456');
    expect(normalisePhone('+371 26-123-456')).toBe('+37126123456');
  });

  it('rejects something too short to be a number (failure)', () => {
    expect(normalisePhone('12')).toBeUndefined();
    expect(normalisePhone('')).toBeUndefined();
    expect(normalisePhone('+371')).toBeUndefined();
  });
});
