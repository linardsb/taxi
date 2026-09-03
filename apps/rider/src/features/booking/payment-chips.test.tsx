import { render, screen, userEvent } from '@testing-library/react-native';
import { formatMessage } from '@taxi/shared';
import { PaymentChips } from './payment-chips';

const t = (key: Parameters<typeof formatMessage>[1]) =>
  formatMessage('lv', key);

describe('PaymentChips', () => {
  it('announces the selection as a checked radio, not by colour (expected — a11y properties 3 and 8)', async () => {
    await render(<PaymentChips value="cash" onChange={jest.fn()} />);

    // Queried BY the checked state, so the assertion fails if `checked` is
    // absent rather than merely wrong — colour alone would leave both unmatched.
    expect(
      screen.getByRole('radio', {
        name: t('rider.book.payment_cash'),
        checked: true,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('radio', {
        name: t('rider.book.payment_card'),
        checked: false,
      }),
    ).toBeTruthy();
  });

  it('reports the chosen method (edge)', async () => {
    const onChange = jest.fn();
    await render(<PaymentChips value="cash" onChange={onChange} />);

    await userEvent.press(
      screen.getByRole('radio', { name: t('rider.book.payment_card') }),
    );

    expect(onChange).toHaveBeenCalledWith('card');
  });

  it('offers ONLY the settleable methods (failure — #70)', async () => {
    await render(<PaymentChips value="cash" onChange={jest.fn()} />);

    // `balance` and `corporate` are refused by the wire, so offering one here
    // would build a booking that settlement cannot finish.
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.queryByLabelText(/balance/i)).toBeNull();
  });
});
