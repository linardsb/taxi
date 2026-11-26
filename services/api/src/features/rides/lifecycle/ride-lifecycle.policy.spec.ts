import type { RideEventActorKind } from '@taxi/shared';
import {
  lifecycleActorFor,
  type CancelInput,
  type LifecycleActor,
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

describe('CancelInput actor pairing (PR 331 L4)', () => {
  it('rejects a role stated twice: actor is derived from eventActor (failure)', () => {
    const input: CancelInput = {
      rideId: '00000000-0000-4000-8000-00000000r001',
      // @ts-expect-error -- `actor` leaves CancelInput; it is derived from `eventActor`
      actor: 'system',
      eventActor: 'dispatcher',
      actorId: '00000000-0000-4000-8000-00000000d001',
      reasonCode: null,
      reasonText: null,
    };
    expect(input.eventActor).toBe('dispatcher');
  });

  const pairs: [RideEventActorKind, LifecycleActor][] = [
    ['rider', 'rider'],
    ['driver', 'driver'],
    ['dispatcher', 'dispatcher'],
    ['admin', 'dispatcher'],
    ['system', 'system'],
  ];
  it.each(pairs)('lifecycleActorFor(%s) is %s (expected)', (kind, actor) => {
    expect(lifecycleActorFor(kind)).toBe(actor);
  });
});
