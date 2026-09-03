import { render } from '@testing-library/react-native';
import { useRef } from 'react';
import { AccessibilityInfo, Text, View } from 'react-native';
import { useScreenFocus } from './use-screen-focus';

function Header({ mounted = true }: { mounted?: boolean }) {
  const ref = useRef<Text>(null);
  useScreenFocus(ref);
  return (
    <View>
      {mounted ? (
        <Text ref={ref} accessibilityRole="header">
          Kurp dosimies?
        </Text>
      ) : null}
    </View>
  );
}

describe('useScreenFocus', () => {
  it('moves screen-reader focus to the header on mount (expected)', async () => {
    const focus = jest
      .spyOn(AccessibilityInfo, 'setAccessibilityFocus')
      .mockImplementation();
    try {
      await render(<Header />);

      // The HANDLE the call receives is whatever this renderer invents, so the
      // assertion is that focus was moved once — not what it was moved to. The
      // TalkBack walkthrough is what confirms the cursor actually lands there.
      expect(focus).toHaveBeenCalledTimes(1);
    } finally {
      focus.mockRestore();
    }
  });

  it('does nothing, and does not throw, when the ref never attached (edge)', async () => {
    const focus = jest
      .spyOn(AccessibilityInfo, 'setAccessibilityFocus')
      .mockImplementation();
    try {
      // A conditionally rendered header is an ordinary state — a screen that
      // crashed here would be worse than one that simply did not move focus.
      await expect(render(<Header mounted={false} />)).resolves.toBeDefined();

      expect(focus).not.toHaveBeenCalled();
    } finally {
      focus.mockRestore();
    }
  });
});
