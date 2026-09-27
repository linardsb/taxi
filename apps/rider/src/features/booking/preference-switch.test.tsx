import { fireEvent, render, screen } from '@testing-library/react-native';
import { colors } from '@taxi/shared';
import { StyleSheet } from 'react-native';
import { PreferenceSwitch } from './preference-switch';

describe('PreferenceSwitch', () => {
  it('shows an accent outline while focused and drops it on blur (expected — PR #293 F3)', async () => {
    await render(
      <PreferenceSwitch
        label="PIN"
        hint="hint"
        value={false}
        enabled
        onChange={() => undefined}
        testID="row"
      />,
    );
    const row = screen.getByTestId('row');
    expect(StyleSheet.flatten(row.props.style).outlineWidth).toBeUndefined();

    await fireEvent(row, 'focus');

    const focused = StyleSheet.flatten(row.props.style);
    expect(focused).toMatchObject({
      outlineWidth: 2,
      outlineColor: colors.accent,
      outlineOffset: 2,
    });
    // An outline, not a border: nothing reflows on focus.
    expect(focused.borderWidth).toBeUndefined();

    await fireEvent(row, 'blur');
    expect(StyleSheet.flatten(row.props.style).outlineWidth).toBeUndefined();
  });
});
