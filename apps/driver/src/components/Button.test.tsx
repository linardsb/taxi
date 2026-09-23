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

  it('passes an accessibility hint through, and none when not given (edge)', async () => {
    await render(
      <Button
        label="Call"
        accessibilityHint="Calls Anna"
        onPress={() => undefined}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Call' }).props.accessibilityHint,
    ).toBe('Calls Anna');
    await screen.unmount();
    await render(<Button label="Save" onPress={() => undefined} />);
    expect(
      screen.getByRole('button', { name: 'Save' }).props.accessibilityHint,
    ).toBeUndefined();
  });
});
