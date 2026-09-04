import { useEffect, type RefObject } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  type Text,
  type View,
} from 'react-native';

/**
 * Moves the screen reader's focus to `ref` on mount — every screen's first act.
 *
 * REACT NATIVE DOES NOT DO THIS FOR YOU. On a new screen the reader keeps its
 * cursor wherever it was, so a rider who tapped "Where to?" lands on the search
 * sheet with focus still on the button that opened it and has to swipe back to
 * the top to find out where they are (`docs/research/rider-ux-evidence.md`
 * §1.4). Every screen in this app calls this on its `accessibilityRole="header"`
 * element; the RNTL assertion that it did is what keeps that true.
 *
 * `setAccessibilityFocus` takes a NODE HANDLE, not a ref and not a component —
 * hence `findNodeHandle`, whose `null` (an unmounted or conditionally rendered
 * header) is a no-op rather than a throw.
 *
 * Point it at the `Text` that carries `accessibilityRole="header"`, not at a
 * wrapping `View`: a bare View is not an accessibility element at all unless it
 * is marked `accessible`, so a role on one is invisible to the reader — and to
 * `getByRole('header')`, which is how the suite pins this.
 */
export function useScreenFocus(ref: RefObject<View | Text | null>): void {
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const handle = findNodeHandle(node);
    if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
  }, [ref]);
}
