import {
  PICKUP_PIN_MAX_ATTEMPTS,
  pickupPinVerdict,
  type PickupPinVerdict,
} from './ride-lifecycle.policy';

describe('pickupPinVerdict (#258)', () => {
  const cases: [
    { pin: string | null; failures: number },
    string | undefined,
    PickupPinVerdict,
    string,
  ][] = [
    [
      { pin: null, failures: 0 },
      undefined,
      'open',
      'no PIN, no entry (expected)',
    ],
    [
      { pin: null, failures: 0 },
      '1234',
      'open',
      'no PIN ignores an entry (edge)',
    ],
    [{ pin: '0042', failures: 0 }, '0042', 'open', 'the right PIN (expected)'],
    [
      { pin: '0042', failures: 0 },
      '42',
      'incorrect',
      'never a numeric compare (edge)',
    ],
    [
      { pin: '0042', failures: 0 },
      undefined,
      'required',
      'no entry on a pinned ride (failure)',
    ],
    [
      { pin: '0042', failures: 4 },
      '9999',
      'incorrect',
      'the 5th wrong attempt still counts (edge)',
    ],
    [
      { pin: '0042', failures: 5 },
      '0042',
      'locked',
      'right PIN, too late (failure)',
    ],
  ];

  it.each(cases)('%j + %j → %s: %s', (gate, entered, verdict) => {
    expect(pickupPinVerdict(gate, entered)).toBe(verdict);
  });

  it('locks at five, the evidence doc figure (expected)', () => {
    expect(PICKUP_PIN_MAX_ATTEMPTS).toBe(5);
  });
});
