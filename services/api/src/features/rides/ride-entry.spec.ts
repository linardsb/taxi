import { RIDE_STATUSES, type RideRequest } from '@taxi/shared';
import {
  assertEntryStatus,
  entryStatusFor,
  RIDE_ENTRY_STATUSES,
} from './ride-entry';

const instant = {} as RideRequest;
const scheduled = {
  scheduledFor: new Date('2026-08-05T18:00:00.000Z'),
} as RideRequest;

describe('ride entry', () => {
  it('enters an instant ride at requested (expected)', () => {
    expect(entryStatusFor(instant)).toBe('requested');
  });

  it('enters a scheduled ride at scheduled (edge)', () => {
    expect(entryStatusFor(scheduled)).toBe('scheduled');
  });

  it('names only real statuses from the shared machine (edge)', () => {
    // A typo here would create rides at a status the state machine has never
    // heard of, and every later transition would throw.
    for (const status of RIDE_ENTRY_STATUSES) {
      expect(RIDE_STATUSES).toContain(status);
    }
  });

  it('refuses to create a ride mid-lifecycle (failure)', () => {
    // The guard that stops a future caller inserting a ride at, say,
    // `in_progress` — which would skip every transition guard between entry and
    // that state.
    expect(() => assertEntryStatus('in_progress')).toThrow(
      /Cannot create a ride at status "in_progress"/,
    );
    expect(() => assertEntryStatus('completed')).toThrow(/assertTransition/);
  });
});
