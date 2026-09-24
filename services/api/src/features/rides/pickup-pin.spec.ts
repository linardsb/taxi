import { randomInt } from 'node:crypto';
import { mintPickupPin } from './pickup-pin';

jest.mock('node:crypto', () => ({
  ...jest.requireActual<typeof import('node:crypto')>('node:crypto'),
  randomInt: jest.fn(),
}));

const mockedRandomInt = randomInt as unknown as jest.Mock;

describe('mintPickupPin (#258)', () => {
  afterEach(() => mockedRandomInt.mockReset());

  it('mints 4 digits every time (expected)', () => {
    const real =
      jest.requireActual<typeof import('node:crypto')>('node:crypto');
    mockedRandomInt.mockImplementation((min: number, max: number) =>
      real.randomInt(min, max),
    );
    for (let i = 0; i < 2_000; i++) {
      expect(mintPickupPin()).toMatch(/^\d{4}$/);
    }
  });

  it('keeps leading zeros (edge)', () => {
    mockedRandomInt.mockReturnValue(7);
    expect(mintPickupPin()).toBe('0007');
  });

  it('draws from the whole 0000–9999 range, max exclusive (failure: a (0, 9999) edit reddens this)', () => {
    mockedRandomInt.mockReturnValue(0);
    mintPickupPin();
    expect(mockedRandomInt).toHaveBeenCalledWith(0, 10_000);
  });
});
