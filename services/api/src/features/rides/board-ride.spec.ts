import { boardFlagsOf } from './board-ride';

describe('boardFlagsOf', () => {
  it('reads both flags off a valid request (expected)', () => {
    expect(
      boardFlagsOf({
        options: {
          childSeat: false,
          femaleDriver: false,
          pickupPin: false,
          announceArrival: true,
        },
      }),
    ).toEqual({ announceArrival: true, pickupPinRequired: false });
  });

  it('reads a request with no options key as both false — the legacy row (edge)', () => {
    expect(boardFlagsOf({})).toEqual({
      announceArrival: false,
      pickupPinRequired: false,
    });
  });

  it('degrades a malformed options value to both false instead of throwing (failure)', () => {
    expect(() => boardFlagsOf({ options: 'junk' })).not.toThrow();
    expect(boardFlagsOf({ options: 'junk' })).toEqual({
      announceArrival: false,
      pickupPinRequired: false,
    });
  });

  it('degrades a null request to both false (failure)', () => {
    expect(boardFlagsOf(null)).toEqual({
      announceArrival: false,
      pickupPinRequired: false,
    });
  });
});
