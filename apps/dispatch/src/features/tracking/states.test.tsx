import { formatMessage, LANGUAGES, TRACKING_PAGE_STATES } from '@taxi/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusScreen, statusLine } from './states';

describe('statusLine', () => {
  it('sources every state line from the shared catalog (expected)', () => {
    for (const lang of LANGUAGES) {
      expect(statusLine(lang, 'arriving')).toBe(
        formatMessage(lang, 'page.arriving'),
      );
    }
  });

  it('gives every state distinct, non-empty copy in every language (edge)', () => {
    // The `Record<TrackingPageState, MessageKey>` type cannot catch a
    // copy-paste (`arrived: 'page.arriving'`) — both sides are valid keys.
    // Distinctness is the gap the compiler leaves; this is that gap.
    for (const lang of LANGUAGES) {
      const lines = TRACKING_PAGE_STATES.map((state) =>
        statusLine(lang, state),
      );
      expect(lines.every((line) => line.length > 0)).toBe(true);
      expect(new Set(lines).size).toBe(TRACKING_PAGE_STATES.length);
    }
  });

  it('never leaks a raw catalog key or unfilled placeholder (failure)', () => {
    for (const lang of LANGUAGES) {
      for (const state of TRACKING_PAGE_STATES) {
        const line = statusLine(lang, state);
        expect(line).not.toMatch(/^page\./);
        expect(line).not.toContain('{');
      }
    }
  });
});

describe('StatusScreen', () => {
  it('renders the message as the page heading (expected)', () => {
    const message = formatMessage('lv', 'page.not_found');
    render(<StatusScreen lang="lv" message={message} />);
    expect(screen.getByRole('heading', { name: message })).toBeInTheDocument();
  });

  it('marks the screen with its own language for screen readers (edge)', () => {
    // A RU notice inside an LV document must be announced in RU — the `lang`
    // attribute is what tells the screen reader to switch voice.
    const message = formatMessage('ru', 'page.expired');
    render(<StatusScreen lang="ru" message={message} />);
    expect(screen.getByRole('main')).toHaveAttribute('lang', 'ru');
  });
});
