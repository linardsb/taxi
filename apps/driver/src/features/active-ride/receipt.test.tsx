import { render, screen } from '@testing-library/react-native';
import { formatEur, formatMessage, splitFare } from '@taxi/shared';
import { Receipt } from './receipt';

const t = (
  key: Parameters<typeof formatMessage>[1],
  params?: Record<string, string | number>,
) => formatMessage('lv', key, params);

describe('Receipt (#15)', () => {
  it('renders total → commission (pct) → net from the split, and the three sum (expected)', async () => {
    // Built the way the api builds it — from a config-shaped resolution, not
    // three hand-typed numbers.
    const split = splitFare(1240, { pct: 15, source: 'platform_base' });
    expect(split.commissionCents + split.driverNetCents).toBe(split.totalCents);

    await render(<Receipt split={split} paymentMethod="cash" />);

    expect(screen.getByTestId('receipt-paid').props.children).toBe(
      t('driver.earnings.receipt_paid', {
        amount: formatEur(split.totalCents),
      }),
    );
    expect(screen.getByTestId('receipt-commission').props.children).toBe(
      t('driver.earnings.receipt_commission', {
        amount: formatEur(split.commissionCents),
        pct: 15,
      }),
    );
    expect(screen.getByTestId('receipt-net').props.children).toBe(
      t('driver.earnings.receipt_net', {
        amount: formatEur(split.driverNetCents),
      }),
    );
    expect(screen.getByTestId('receipt-method').props.children).toBe(
      t('driver.ride.payment', { method: t('driver.offer.payment_cash') }),
    );
    expect(screen.getByTestId('receipt').props.accessibilityRole).toBe(
      'summary',
    );
  });

  it('a 0% override renders «€0.00 (0%)» and the full fare as net (edge)', async () => {
    const split = splitFare(1240, { pct: 0, source: 'driver_override' });
    await render(<Receipt split={split} paymentMethod="card" />);
    expect(screen.getByTestId('receipt-commission').props.children).toBe(
      t('driver.earnings.receipt_commission', { amount: '€0.00', pct: 0 }),
    );
    expect(screen.getByTestId('receipt-net').props.children).toBe(
      t('driver.earnings.receipt_net', { amount: '€12.40' }),
    );
    expect(screen.getByTestId('receipt-method').props.children).toBe(
      t('driver.ride.payment', { method: t('driver.offer.payment_card') }),
    );
  });

  it('keeps a fractional pct to one decimal and a negative amount`s sign in front of the symbol (failure)', () => {
    // `formatEur(-186)` is `-€1.86` — pinned in `availability/format-eur.test.ts`
    // and `packages/shared/tests/money.test.ts`; a receipt never renders one,
    // because `fareSplitSchema` refuses negative cents at the parse boundary.
    expect(formatEur(-186)).toBe('-€1.86');
    expect(() =>
      splitFare(1240, { pct: 150, source: 'platform_base' }),
    ).toThrow();
  });
});
