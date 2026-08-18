import type { AddressPoint, AddressSuggestion } from '@taxi/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddressField } from './address-field';
import type { DraftAddress } from './booking-draft';

const SUGGESTIONS: AddressSuggestion[] = [
  {
    placeId: 'place-1',
    primaryText: 'Brīvības iela 45',
    secondaryText: 'Rīga, Latvija',
  },
  {
    placeId: 'place-2',
    primaryText: 'Brīvības gatve 214',
    secondaryText: 'Rīga, Latvija',
  },
];

const POINT: AddressPoint = {
  location: { lat: 56.9496, lng: 24.1052 },
  address: 'Brīvības iela 45, Rīga',
};

const emptyValue = (over: Partial<DraftAddress> = {}): DraftAddress => ({
  text: '',
  point: null,
  placeId: null,
  resolvedAtMs: null,
  ...over,
});

function renderField(
  over: {
    value?: DraftAddress;
    offline?: boolean;
    search?: (query: string, session: string) => Promise<AddressSuggestion[]>;
    resolve?: (
      placeId: string,
      session: string,
    ) => Promise<AddressPoint | null>;
  } = {},
) {
  const onTextChange = vi.fn();
  const onResolved = vi.fn();
  const search = over.search ?? vi.fn().mockResolvedValue(SUGGESTIONS);
  const resolve = over.resolve ?? vi.fn().mockResolvedValue(POINT);
  const view = render(
    <AddressField
      label="Izbraukšanas vieta"
      value={over.value ?? emptyValue()}
      offline={over.offline ?? false}
      onTextChange={onTextChange}
      onResolved={onResolved}
      search={search}
      resolve={resolve}
    />,
  );
  return { view, onTextChange, onResolved, search, resolve };
}

describe('AddressField', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('searches after the debounce and lists the suggestions (expected)', async () => {
    const { search } = renderField({ value: emptyValue({ text: 'brivibas' }) });

    expect(search).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));
    expect(search).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('combobox')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('reuses ONE session token across keystrokes and rotates it on resolve (expected)', async () => {
    const search = vi.fn().mockResolvedValue(SUGGESTIONS);
    const resolve = vi.fn().mockResolvedValue(POINT);
    const { view } = renderField({
      value: emptyValue({ text: 'briv' }),
      search,
      resolve,
    });
    vi.advanceTimersByTime(300);
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));

    view.rerender(
      <AddressField
        label="Izbraukšanas vieta"
        value={emptyValue({ text: 'brivibas' })}
        offline={false}
        onTextChange={vi.fn()}
        onResolved={vi.fn()}
        search={search}
        resolve={resolve}
      />,
    );
    vi.advanceTimersByTime(300);
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));

    const firstSession = (search.mock.calls[0] as [string, string])[1];
    const secondSession = (search.mock.calls[1] as [string, string])[1];
    // One session per FIELD, not per keystroke — this is the difference
    // between a burst billing as one session and billing as N requests.
    expect(secondSession).toBe(firstSession);

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    // The resolve TERMINATED that session; reusing it would bill the next
    // search against a spent one.
    expect((resolve.mock.calls[0] as [string, string])[1]).toBe(firstSession);
  });

  it('completes selection with the keyboard alone (expected — AC #6)', async () => {
    const { onResolved, resolve } = renderField({
      value: emptyValue({ text: 'brivibas' }),
    });
    vi.advanceTimersByTime(300);
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));

    const combobox = screen.getByRole('combobox');
    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    expect(combobox).toHaveAttribute(
      'aria-activedescendant',
      expect.stringContaining('option-1'),
    );
    fireEvent.keyDown(combobox, { key: 'ArrowUp' });
    fireEvent.keyDown(combobox, { key: 'Enter' });

    await waitFor(() =>
      expect(onResolved).toHaveBeenCalledWith(POINT, 'place-1'),
    );
    expect(resolve).toHaveBeenCalledWith('place-1', expect.any(String));
  });

  it('opens on Alt+ArrowDown without moving the selection (edge — APG)', async () => {
    renderField({ value: emptyValue({ text: 'brivibas' }) });
    vi.advanceTimersByTime(300);
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));

    const combobox = screen.getByRole('combobox');
    fireEvent.keyDown(combobox, { key: 'Escape' });
    expect(combobox).toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(combobox, { key: 'ArrowDown', altKey: true });
    expect(combobox).toHaveAttribute('aria-expanded', 'true');
    expect(combobox).not.toHaveAttribute('aria-activedescendant');
  });

  it('closes on the first Escape and clears on the second (edge — APG)', async () => {
    const { onTextChange } = renderField({
      value: emptyValue({ text: 'brivibas' }),
    });
    vi.advanceTimersByTime(300);
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));

    const combobox = screen.getByRole('combobox');
    fireEvent.keyDown(combobox, { key: 'Escape' });
    // The first Escape belongs to the popup — it must not throw away what was
    // typed on the way past.
    expect(onTextChange).not.toHaveBeenCalled();

    fireEvent.keyDown(combobox, { key: 'Escape' });
    expect(onTextChange).toHaveBeenCalledWith('');
  });

  it('lets the terminal Escape reach the dialog (edge — H5)', async () => {
    // The field is rendered inside a stub standing in for `DialogShell`: its
    // Escape handler is a React `onKeyDown` on an ANCESTOR, so a
    // `stopPropagation()` in the field is what decides whether the dispatcher
    // can close the form she is typing in. Nothing asserted this, which is how
    // an unconditional `stopPropagation()` shipped past a green gate while
    // three separate comments promised "Escape ALWAYS closes".
    const onClose = vi.fn();
    render(
      <div onKeyDown={(event) => event.key === 'Escape' && onClose()}>
        <AddressField
          label="Izbraukšana"
          value={emptyValue()}
          offline={false}
          onTextChange={vi.fn()}
          onResolved={vi.fn()}
          search={vi.fn().mockResolvedValue([])}
          resolve={vi.fn().mockResolvedValue(null)}
        />
      </div>,
    );

    // An EMPTY field with no popup: this Escape consumes nothing, so it belongs
    // to the dialog.
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the popup Escape away from the dialog (edge — H5)', async () => {
    const onClose = vi.fn();
    render(
      <div onKeyDown={(event) => event.key === 'Escape' && onClose()}>
        <AddressField
          label="Izbraukšana"
          value={emptyValue({ text: 'brivibas' })}
          offline={false}
          onTextChange={vi.fn()}
          onResolved={vi.fn()}
          search={vi.fn().mockResolvedValue(SUGGESTIONS)}
          resolve={vi.fn().mockResolvedValue(POINT)}
        />
      </div>,
    );
    vi.advanceTimersByTime(300);
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));

    // An Escape the popup consumes must NOT also close the dialog behind it.
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not query below the minimum length (edge)', () => {
    const { search } = renderField({ value: emptyValue({ text: 'br' }) });

    vi.advanceTimersByTime(1_000);

    expect(search).not.toHaveBeenCalled();
  });

  it('passes "iela + number" input through unaltered (edge)', async () => {
    const { search } = renderField({ value: emptyValue({ text: '45 briv' }) });

    vi.advanceTimersByTime(300);

    await waitFor(() =>
      expect(search).toHaveBeenCalledWith('45 briv', expect.any(String)),
    );
  });

  it('keeps the typed text and says why when offline (failure)', () => {
    const { search } = renderField({
      value: emptyValue({ text: 'Kaļķu iela 28' }),
      offline: true,
    });

    vi.advanceTimersByTime(1_000);

    // No spend, no popup — and above all, the typed address is still there.
    expect(search).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox')).toHaveValue('Kaļķu iela 28');
    expect(
      screen.getByText(/Bezsaistē — adresi saglabāsim/),
    ).toBeInTheDocument();
  });

  it('reports a failed search instead of an empty list (failure)', async () => {
    renderField({
      value: emptyValue({ text: 'brivibas' }),
      search: vi.fn().mockRejectedValue(new Error('offline')),
    });

    vi.advanceTimersByTime(300);

    await waitFor(() =>
      expect(
        screen.getByText('Adrešu meklēšana nedarbojas'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByRole('combobox')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('reports a place the provider has forgotten (failure)', async () => {
    const { onResolved } = renderField({
      value: emptyValue({ text: 'brivibas' }),
      resolve: vi.fn().mockResolvedValue(null),
    });
    vi.advanceTimersByTime(300);
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2));

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' });
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });

    await waitFor(() =>
      expect(
        screen.getByText('Adrešu meklēšana nedarbojas'),
      ).toBeInTheDocument(),
    );
    expect(onResolved).not.toHaveBeenCalled();
  });

  it('stops searching once a suggestion is resolved (edge)', () => {
    const { search } = renderField({
      value: emptyValue({
        text: 'Brīvības iela 45, Rīga',
        point: POINT,
        placeId: 'place-1',
        resolvedAtMs: 1,
      }),
    });

    vi.advanceTimersByTime(1_000);

    expect(search).not.toHaveBeenCalled();
  });
});
