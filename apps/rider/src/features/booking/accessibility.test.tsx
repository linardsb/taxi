import { render, screen } from '@testing-library/react-native';
import { MESSAGES, type MessageKey } from '@taxi/shared';
import { StyleSheet } from 'react-native';
import { Button } from '@/components';
import { PaymentChips } from './payment-chips';

/**
 * The sweep. Every property in the plan's accessibility spec is asserted
 * alongside the screen that owns it; this file covers the three that are
 * properties of the app as a whole rather than of any one screen, so that a
 * later screen cannot quietly break them.
 */
describe('accessibility properties', () => {
  it('every interactive element clears the 44 px floor (property 2)', async () => {
    await render(<Button label="Book" onPress={() => undefined} />);
    expect(
      StyleSheet.flatten(
        screen.getByRole('button', { name: 'Book' }).props.style,
      ).minHeight,
    ).toBeGreaterThanOrEqual(44);

    await render(<PaymentChips value="cash" onChange={() => undefined} />);
    for (const chip of screen.getAllByRole('radio')) {
      const style = StyleSheet.flatten(chip.props.style);
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
      expect(style.minWidth).toBeGreaterThanOrEqual(44);
    }
  });

  it('a disabled control says so on accessibilityState, not by colour alone (property 3)', async () => {
    await render(<Button label="Book" onPress={() => undefined} disabled />);
    const button = screen.getByRole('button', { name: 'Book' });
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });

    await render(<Button label="Booking" onPress={() => undefined} loading />);
    expect(
      screen.getByRole('button', { name: 'Booking' }).props.accessibilityState,
    ).toMatchObject({ busy: true, disabled: true });
  });

  it('rider labels are audio-lean — no role echoed into the text (property 10)', () => {
    // The role already says "button"; repeating it costs a word on every
    // element, and blind riders consume audio at up to 3× speed (§1.2).
    const noise = /\b(poga|button|кнопка|link|saite|ссылка)\b/i;
    // Collected rather than asserted per key: jest's `expect` takes one
    // argument, so an empty-array assertion is what names the offender.
    const offenders: string[] = [];
    for (const lang of ['lv', 'ru', 'en'] as const) {
      for (const [key, copy] of Object.entries(MESSAGES[lang]) as [
        MessageKey,
        string,
      ][]) {
        if (key.startsWith('rider.') && noise.test(copy)) {
          offenders.push(`${lang}:${key} → "${copy}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every rider key carries copy in all three languages (property 2 — no blank labels)', () => {
    const riderKeys = (Object.keys(MESSAGES.lv) as MessageKey[]).filter((k) =>
      k.startsWith('rider.'),
    );
    // A label that renders empty is an unlabelled control, which is the one
    // failure a screen reader cannot work around.
    expect(riderKeys.length).toBeGreaterThan(0);
    const blank: string[] = [];
    for (const lang of ['lv', 'ru', 'en'] as const) {
      for (const key of riderKeys) {
        if (MESSAGES[lang][key].trim() === '') blank.push(`${lang}:${key}`);
      }
    }
    expect(blank).toEqual([]);
  });
});
