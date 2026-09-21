import { SMS_DRIVER_NAME_MAX_CHARS } from '@taxi/shared';
import { driverFirstName, smsDriverName } from './sms-templates';

describe('smsDriverName', () => {
  it('keeps a first name that fits (expected)', () => {
    expect(smsDriverName('Jānis Bērziņš')).toBe('Jānis');
  });

  it("renders '—' for a driver with no name yet (edge)", () => {
    expect(smsDriverName(null)).toBe('—');
    expect(smsDriverName('   ')).toBe('—');
  });

  it('abbreviates a first name over the bound (failure)', () => {
    // `Konstantīn` would be a mangled name; `K.` is a form people use.
    expect(smsDriverName('Konstantīns Ozoliņš')).toBe('K.');
  });

  it('never exceeds the bound the SMS budget assumes (the bound)', () => {
    // THIS is the assertion that makes #136's budget total rather than
    // sampled: `users.display_name` is `text` and `userSchema.displayName`
    // allows 120 characters, so without a bound here a budgeted test would
    // prove nothing about a real rider's message.
    const inputs = [
      null,
      '   ',
      'Jānis Bērziņš',
      'Konstantīns Ozoliņš',
      'A'.repeat(120), // the userSchema.displayName ceiling
      '𝒜leksandrs Ozoliņš', // first character is a surrogate pair
      'Анна-Мария Петровская',
    ];

    // Asserted as a set rather than in a loop: jest's `expect` takes no label
    // argument, so a failing loop iteration would not say WHICH input blew the
    // bound. An empty array names every offender at once.
    const overBound = inputs.filter(
      (input) => smsDriverName(input).length > SMS_DRIVER_NAME_MAX_CHARS,
    );

    expect(overBound).toEqual([]);
  });

  it('abbreviates a surrogate-pair initial whole, not half (edge)', () => {
    // `first[0]` would slice the pair and leave a lone surrogate: a broken
    // glyph on the handset, for the same one code unit a character costs.
    const abbreviated = smsDriverName('𝒜leksandrs Ozoliņš');
    expect(abbreviated).toBe('𝒜.');
    expect([...abbreviated]).toHaveLength(2);
  });
});

describe('driverFirstName', () => {
  it('stays UNTRUNCATED for the tracking page (edge)', () => {
    // The page has no character budget, and abbreviating a name there is a
    // regression. Pinned beside the SMS contract on the same input.
    expect(driverFirstName('Konstantīns Ozoliņš')).toBe('Konstantīns');
    expect(smsDriverName('Konstantīns Ozoliņš')).toBe('K.');
  });
});
