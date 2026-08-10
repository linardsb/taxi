import { describe, expect, it } from 'vitest';
import { phoneSchema } from '../src/schemas/user';

describe('phoneSchema', () => {
  it('accepts a Latvian mobile in E.164 (expected)', () => {
    expect(phoneSchema.safeParse('+37129123456').success).toBe(true);
  });
  it('accepts a foreign number (edge)', () => {
    expect(phoneSchema.safeParse('+491701234567').success).toBe(true);
  });
  it('rejects local format without country code (failure)', () => {
    expect(phoneSchema.safeParse('29123456').success).toBe(false);
  });
});
