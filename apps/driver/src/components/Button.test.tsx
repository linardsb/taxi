import { fireEvent, render, screen } from '@testing-library/react-native';
import { colors } from '@taxi/shared';
import { StyleSheet } from 'react-native';
import { Button } from './Button';

describe('Button', () => {
  it('shows a focus ring that contrasts with the primary fill — a `colors.fg` outline, gone on blur (expected)', async () => {
    await render(<Button label="Save" onPress={() => undefined} />);
    const button = screen.getByRole('button', { name: 'Save' });

    await fireEvent(button, 'focus');

    const focused = StyleSheet.flatten(button.props.style);
    expect(focused).toMatchObject({
      backgroundColor: colors.accent,
      outlineWidth: 2,
      outlineColor: colors.fg,
      outlineOffset: 2,
    });
    // The ring must differ from the fill it sits on, or it is invisible.
    expect(focused.outlineColor).not.toBe(focused.backgroundColor);
    // An outline, not a border: nothing reflows on focus.
    expect(focused.borderWidth).toBeUndefined();

    await fireEvent(button, 'blur');
    expect(StyleSheet.flatten(button.props.style).outlineWidth).toBeUndefined();
  });
});
