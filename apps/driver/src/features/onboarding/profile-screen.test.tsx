import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { colors, formatMessage } from '@taxi/shared';
import { ProfileScreen } from './profile-screen';

let mockLanguages: string[] = ['lv'];
jest.mock('./use-me', () => ({
  useMe: () => ({
    me: {
      profile: { spokenLanguages: mockLanguages, isFemale: false },
      vehicles: [],
    },
    status: 'ready',
    refetch: jest.fn(),
    patchProfile: jest.fn(),
    createVehicle: jest.fn(),
    updateVehicle: jest.fn(),
  }),
}));

const t = (key: Parameters<typeof formatMessage>[1]) =>
  formatMessage('lv', key);

const flat = (chip: ReturnType<typeof screen.getByLabelText>) =>
  StyleSheet.flatten(chip.props.style as StyleProp<ViewStyle>) as Record<
    string,
    unknown
  >;

beforeEach(() => {
  mockLanguages = ['lv'];
});

describe('ProfileScreen — language chips', () => {
  /**
   * The ring must be an OUTLINE, not a border: `toMatchObject` alone is a
   * partial match, so it passed for a ring that had grown a `borderWidth`
   * (2 px of reflow on focus) or been recoloured to read as a fill (review
   * F41). Both chips are exercised, because the docblock's guarantee is that
   * the ring survives the checked, accent-filled one.
   */
  it.each([
    ['unchecked', ['lv']],
    ['checked', ['lv', 'ru']],
  ])(
    'a focused %s chip shows the outline ring, reflows nothing, and loses it on blur (edge — review F29/F41)',
    async (_name, languages) => {
      mockLanguages = languages;
      await render(<ProfileScreen />);
      const chip = screen.getByLabelText(t('driver.lang.ru'));
      const resting = flat(chip);

      await fireEvent(chip, 'focus');
      const focused = flat(chip);
      expect(focused.outlineWidth).toBe(2);
      // …in `colors.fg`, the Button's ring — an accent ring on an accent
      // chip is a fill, not a ring.
      expect(focused.outlineColor).toBe(colors.fg);
      expect(focused.outlineColor).not.toBe(focused.backgroundColor);
      // …and nothing in the box model moved.
      expect(focused.borderWidth).toBe(resting.borderWidth);

      await fireEvent(chip, 'blur');
      expect(flat(chip).outlineWidth).toBeUndefined();
    },
  );
});
