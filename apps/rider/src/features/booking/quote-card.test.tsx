import { render, screen } from '@testing-library/react-native';
import { formatMessage, type FareQuote } from '@taxi/shared';
import { QuoteCard } from './quote-card';

const QUOTE: FareQuote = {
  model: 'upfront_fixed',
  currency: 'EUR',
  totalCents: 840,
  breakdown: {
    baseCents: 200,
    distanceCents: 540,
    timeCents: 100,
    discountCents: 0,
  },
};

const t = (
  key: Parameters<typeof formatMessage>[1],
  p?: Record<string, string>,
) => formatMessage('lv', key, p);

describe('QuoteCard', () => {
  it('reads as ONE utterance: total first, breakdown after (expected — a11y property 5)', async () => {
    await render(<QuoteCard quote={QUOTE} state="ready" />);

    // Four Texts, one stop. A blind rider consuming audio at 3× pays for every
    // extra element, and the price is one fact, not four.
    const label = `${t('rider.book.quote_total', { total: '€8.40' })}. ${t(
      'rider.book.quote_breakdown',
      { base: '€2.00', distance: '€5.40', time: '€1.00' },
    )}.`;
    expect(screen.getByLabelText(label)).toBeTruthy();
  });

  it('shows a labelled spinner while the quote is in flight (edge)', async () => {
    await render(<QuoteCard quote={null} state="loading" />);

    // A bare spinner is silent — the wait itself has to be announceable.
    expect(screen.getByLabelText(t('rider.book.searching'))).toBeTruthy();
    expect(screen.queryByTestId('quote-card')).toBeNull();
  });

  it('renders nothing at all when the quote failed or was discarded (failure)', async () => {
    await render(<QuoteCard quote={null} state="failed" />);
    expect(screen.queryByTestId('quote-card')).toBeNull();

    // A stale quote with a non-ready state must not be shown either: the price
    // on screen is the price the rider is agreeing to.
    await render(<QuoteCard quote={QUOTE} state="idle" />);
    expect(screen.queryByTestId('quote-card')).toBeNull();
  });
});
