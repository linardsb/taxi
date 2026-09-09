import type { BannerProps } from '@/components';
import { errorMessageKey, type T } from '@/features/i18n';
import type { OfferState } from './offer-state';

/**
 * The home screen's offer banner — `taken` / `expired` / `cancelled` / a
 * recoverable error — as a pure state → props mapper, the shape of
 * `home-screen.tsx`'s `bannerFor`, so home stays a composer.
 */
export function offerBannerFor(
  state: OfferState,
  t: T,
  dismiss: () => void,
): Omit<BannerProps, 'testID'> | null {
  switch (state.banner) {
    case null:
      return null;
    case 'taken':
      return { tone: 'info', text: t('driver.offer.revoked_taken') };
    case 'expired':
      return { tone: 'info', text: t('driver.offer.revoked_expired') };
    case 'cancelled':
      return { tone: 'warning', text: t('driver.offer.revoked_cancelled') };
    case 'error':
      return {
        tone: 'danger',
        text: t(errorMessageKey(state.errorCode ?? 'generic')),
        action: { label: t('driver.action.done'), onPress: dismiss },
      };
  }
}
