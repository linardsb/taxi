import { Redirect } from 'expo-router';
import { useT } from '@/features/i18n';
import { OfferCard } from './offer-card';
import { offerCardProps } from './offer-card-props';
import { useOffers } from './use-offers';

/**
 * The `/offer` route: the card while one is pending or being answered, a
 * redirect home otherwise (a push tap after the card expired lands here with
 * nothing to show — home carries the banner).
 */
export function OfferScreen() {
  const t = useT();
  const { state, latest, accept, decline } = useOffers();
  const card = offerCardProps(state, latest, t);
  if (!card) return <Redirect href="/home" />;
  return <OfferCard card={card} onAccept={accept} onDecline={decline} />;
}
