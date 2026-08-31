import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { formatMessage } from '@taxi/shared';
import { ProfileScreen } from './profile-screen';

jest.mock('./use-me', () => ({
  useMe: () => ({
    me: {
      profile: { spokenLanguages: ['lv'], isFemale: false },
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

describe('ProfileScreen — language chips', () => {
  it('a focused chip shows the outline ring and loses it on blur (edge — review F29)', async () => {
    await render(<ProfileScreen />);
    const chip = screen.getByLabelText(t('driver.lang.ru'));

    await fireEvent(chip, 'focus');
    // The ring is an outline, not a border: it must not reflow the chip and
    // must stay visible on the checked, accent-filled chip too.
    expect(StyleSheet.flatten(chip.props.style)).toMatchObject({
      outlineWidth: 2,
    });

    await fireEvent(chip, 'blur');
    expect(StyleSheet.flatten(chip.props.style).outlineWidth).toBeUndefined();
  });
});
