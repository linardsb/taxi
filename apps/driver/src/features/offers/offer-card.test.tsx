import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { formatMessage } from '@taxi/shared';
import { OfferCard } from './offer-card';
import type { OfferCardProps } from './offer-card-props';

const t = (
  key: Parameters<typeof formatMessage>[1],
  params?: Record<string, string | number>,
) => formatMessage('lv', key, params);

const card = (over: Partial<OfferCardProps> = {}): OfferCardProps => ({
  fare: t('driver.offer.fare', { amount: '€12.40' }),
  youKeep: t('driver.offer.you_keep', { amount: '€10.54', pct: 85 }),
  pickup: t('driver.offer.pickup', { address: 'Brīvības iela 1' }),
  destination: t('driver.offer.destination', { address: 'Teika' }),
  eta: t('driver.offer.eta', { minutes: 5, km: '1.0' }),
  km: 1,
  payment: t('driver.offer.payment_cash'),
  seconds: 18,
  countdown: t('driver.offer.countdown', { seconds: 18 }),
  glance: false,
  queue: null,
  a11yLabel: t('driver.offer.a11y_card', {
    amount: '€12.40',
    net: '€10.54',
    seconds: 18,
  }),
  accepting: false,
  ...over,
});

const flat = (node: ReturnType<typeof screen.getByTestId>) =>
  StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>) as Record<
    string,
    unknown
  >;

describe('OfferCard (#15)', () => {
  it('the whole card is one labelled accept target and decline is a separate 44 px button (expected)', async () => {
    const onAccept = jest.fn();
    const onDecline = jest.fn();
    await render(
      <OfferCard card={card()} onAccept={onAccept} onDecline={onDecline} />,
    );

    const accept = screen.getByLabelText(card().a11yLabel);
    expect(accept.props.accessibilityRole).toBe('button');
    await fireEvent.press(accept);
    expect(onAccept).toHaveBeenCalledTimes(1);

    const decline = screen.getByTestId('offer-decline');
    expect(flat(decline).minHeight).toBe(44);
    await fireEvent.press(decline);
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledTimes(1); // decline sits OUTSIDE the accept target

    // The fare, the net line and the payment pill are all above the fold.
    expect(screen.getByTestId('offer-fare').props.children).toBe(card().fare);
    expect(screen.getByText(card().youKeep)).toBeTruthy();
    expect(screen.getByText(t('driver.offer.payment_cash'))).toBeTruthy();
  });

  it('glance mode drops the addresses, ETA and queue but keeps the payment pill (edge)', async () => {
    await render(
      <OfferCard
        card={card({ glance: true, queue: 'Rindā: 2. no 5 · rix' })}
        onAccept={jest.fn()}
        onDecline={jest.fn()}
      />,
    );
    expect(screen.queryByTestId('offer-details')).toBeNull();
    expect(screen.queryByText('Rindā: 2. no 5 · rix')).toBeNull();
    expect(screen.getByTestId('offer-payment')).toBeTruthy();
    expect(screen.getByTestId('offer-fare')).toBeTruthy();
  });

  it('while accepting, both targets are disabled and the countdown reads «accepting» (failure)', async () => {
    const onAccept = jest.fn();
    await render(
      <OfferCard
        card={card({ accepting: true })}
        onAccept={onAccept}
        onDecline={jest.fn()}
      />,
    );
    await fireEvent.press(screen.getByTestId('offer-accept'));
    expect(onAccept).not.toHaveBeenCalled();
    expect(
      screen.getByTestId('offer-accept').props.accessibilityState,
    ).toMatchObject({
      disabled: true,
      busy: true,
    });
    expect(screen.getByTestId('offer-countdown').props.children).toBe(
      t('driver.offer.accepting'),
    );
  });
});
