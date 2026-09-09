import type { DriverEarningsToday } from '@taxi/shared';
import type { T } from '@/features/i18n';
import { formatEur } from './format-eur';
import type { EarningsStatus } from './use-earnings';

/** Punctuation, not copy: the "no number" state, on both surfaces that show one. */
export const NO_EARNINGS = '—';

/**
 * Today's net as one string, for the two surfaces that render it: the home
 * card and the earnings screen. `null` is the load window — a spinner, not
 * text — which is exactly why the three states are a returned value here and
 * not JSX inside the card.
 *
 * It lives OUTSIDE `EarningsCard` because the home screen's link needs the
 * same text for its accessible name. That link is a grouping `Pressable`, so
 * an explicit `accessibilityLabel` REPLACES the collapsed child text instead
 * of adding to it: the card cannot own the string and the link have it too
 * (F4 relied on the collapse, F20 on composing the name by hand).
 *
 * One key for both surfaces. `driver.earnings.today` was byte-identical to
 * `driver.home.today` in all three catalogs — six entries for one string — so
 * it is gone (F14); give the screen its own key back the day the copy actually
 * diverges from the card's.
 */
export function earningsBody(
  earnings: DriverEarningsToday | null,
  status: EarningsStatus,
  t: T,
): string | null {
  if (earnings) {
    return t('driver.home.today', {
      amount: formatEur(earnings.earnedCents),
      rides: earnings.rideCount,
    });
  }
  // A failed FIRST load only: `useEarnings` keeps the last good value across
  // an error, so a refresh that fails still shows yesterday's number.
  return status === 'error' ? NO_EARNINGS : null;
}
