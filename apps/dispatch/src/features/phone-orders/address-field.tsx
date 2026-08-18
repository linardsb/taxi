'use client';

import {
  formatMessage,
  type AddressPoint,
  type AddressSuggestion,
  type Language,
} from '@taxi/shared';
import { useEffect, useId, useRef, useState } from 'react';
import type { DraftAddress } from './booking-draft';
import { newUuid } from './ids';

const LANG: Language = 'lv';

/**
 * Client-side debounce. The server floor (`PLACES_SEARCH_MIN_CHARS`) and the
 * per-dispatcher rate limit are what BOUND the bill; this only keeps an
 * ordinary typist from paying per keystroke. 300 ms is the plan's figure and is
 * `expected`, not measured — a slower typist produces more requests, which is
 * the assumption plan Q5 says to check against the first real bill.
 */
const DEBOUNCE_MS = 300;

/**
 * Mirrors the api's `PLACES_SEARCH_MIN_CHARS` default. A deliberate duplicate:
 * the console cannot read the server's env, and below this the api answers `[]`
 * anyway — matching it here saves the round trip rather than deciding anything.
 */
const MIN_CHARS = 3;

type Status = 'idle' | 'searching' | 'empty' | 'failed';

/** A search response, tagged with the query it answered. */
interface QueryResults {
  query: string;
  suggestions: AddressSuggestion[];
  status: 'ok' | 'empty' | 'failed';
}

/** The highlighted row, tagged the same way so it resets with the query. */
interface Selection {
  query: string;
  index: number;
}

/**
 * An ARIA APG combobox with a listbox popup, hand-rolled because the repo has
 * no component library.
 *
 * ZERO-MOUSE COMPLETION IS AN ACCEPTANCE CRITERION here, not a nicety: a
 * 25-year dispatcher's hands live on the keyboard, and the APG keyboard table
 * IS this component's spec — Down opens and moves, Alt+Down opens without
 * moving, Up moves back, Enter selects, Escape closes and then clears.
 *
 * OFFLINE it accepts free text into the draft and says why it cannot be booked.
 * Silently dropping a typed address is the exact "console traps data" failure
 * the whole draft-persistence rule exists to prevent.
 */
export function AddressField({
  label,
  value,
  offline,
  onTextChange,
  onResolved,
  search,
  resolve,
}: Readonly<{
  label: string;
  value: DraftAddress;
  offline: boolean;
  onTextChange: (text: string) => void;
  onResolved: (point: AddressPoint, placeId: string) => void;
  search: (query: string, session: string) => Promise<AddressSuggestion[]>;
  resolve: (placeId: string, session: string) => Promise<AddressPoint | null>;
}>) {
  const baseId = useId();
  const listId = `${baseId}-listbox`;
  /**
   * Every piece of popup state is TAGGED WITH THE QUERY it belongs to, and the
   * rest is derived from that. Storing `suggestions`/`open`/`status` separately
   * meant an effect that synchronously cleared three of them whenever the field
   * went inactive — cascading renders, and the source of stale-result bugs the
   * tag makes unrepresentable: a response for an older query simply never
   * matches the current one.
   */
  const [results, setResults] = useState<QueryResults | null>(null);
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [resolveFailed, setResolveFailed] = useState(false);

  /**
   * ONE session token per field instance, reused across this field's
   * keystrokes and rotated only after a resolve terminates it. That is what
   * collapses a burst of autocomplete requests into a single billed session —
   * minting per keystroke would bill each one separately.
   */
  const session = useRef(newUuid());

  const typed = value.text;
  const query = typed.trim();
  const resolved = value.point !== null;
  /**
   * A resolved field is not searching: selecting a suggestion sets the text to
   * its address, and re-querying that would reopen the popup under the
   * dispatcher's next Tab.
   */
  const searchable = !resolved && !offline && query.length >= MIN_CHARS;

  const current = searchable && results?.query === query ? results : null;
  const suggestions = current?.status === 'ok' ? current.suggestions : [];
  const open = suggestions.length > 0 && closedFor !== query;
  const activeIndex = selection?.query === query ? selection.index : -1;
  const status: Status = resolveFailed
    ? 'failed'
    : !searchable
      ? 'idle'
      : current === null
        ? 'searching'
        : current.status === 'failed'
          ? 'failed'
          : current.status === 'empty'
            ? 'empty'
            : 'idle';

  useEffect(() => {
    if (!searchable) return;
    const timer = setTimeout(() => {
      void search(query, session.current)
        .then((found) =>
          setResults({
            query,
            suggestions: found,
            status: found.length === 0 ? 'empty' : 'ok',
          }),
        )
        .catch(() => setResults({ query, suggestions: [], status: 'failed' }));
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, searchable, search]);

  const select = (suggestion: AddressSuggestion) => {
    setClosedFor(query);
    setResolveFailed(false);
    void resolve(suggestion.placeId, session.current)
      .then((point) => {
        // The token is spent either way — a resolve terminates the session
        // whether or not the place still exists, so the next search must not
        // reuse it.
        session.current = newUuid();
        if (point === null) {
          setResolveFailed(true);
          return;
        }
        onResolved(point, suggestion.placeId);
      })
      .catch(() => {
        session.current = newUuid();
        setResolveFailed(true);
      });
  };

  const moveTo = (index: number) => setSelection({ query, index });

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (suggestions.length === 0) return;
      // Alt+Down opens WITHOUT moving the selection, per the APG table.
      if (!open) {
        setClosedFor(null);
        if (event.altKey) return;
      }
      moveTo(Math.min(activeIndex + 1, suggestions.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) return;
      moveTo(Math.max(activeIndex - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      if (!open || activeIndex < 0) return;
      // Only when a suggestion is highlighted: an Enter on a plain text field
      // belongs to the form, and swallowing it would break submit-on-Enter.
      event.preventDefault();
      const suggestion = suggestions[activeIndex];
      if (suggestion !== undefined) select(suggestion);
      return;
    }
    if (event.key === 'Escape') {
      // Closes first, clears second, CLOSES THE DIALOG third.
      //
      // Propagation stops only where this field actually consumes the key.
      // `DialogShell`'s handler is a React `onKeyDown` on an ancestor, so an
      // unconditional `stopPropagation()` here made "Escape ALWAYS closes"
      // false for every field in the form: the third Escape cleared an already
      // empty input and was swallowed, and the dispatcher had to Tab to
      // «Aizvērt» to leave a dialog she may have opened by accident.
      if (open) {
        event.stopPropagation();
        setClosedFor(query);
        return;
      }
      if (typed !== '') {
        event.stopPropagation();
        onTextChange('');
      }
    }
  };

  const messageKey =
    offline && typed !== ''
      ? 'console.address_offline'
      : status === 'searching'
        ? 'console.address_searching'
        : status === 'empty'
          ? 'console.address_no_results'
          : status === 'failed'
            ? 'console.address_failed'
            : !resolved && typed.trim().length >= MIN_CHARS
              ? 'console.address_unresolved'
              : 'console.address_search_hint';

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-xs)' }}>
      <label
        htmlFor={baseId}
        style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}
      >
        {label}
      </label>
      <input
        id={baseId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-describedby={`${baseId}-status`}
        aria-activedescendant={
          open && activeIndex >= 0
            ? `${baseId}-option-${activeIndex}`
            : undefined
        }
        value={typed}
        onChange={(event) => {
          setResolveFailed(false);
          onTextChange(event.target.value);
        }}
        onKeyDown={onKeyDown}
        autoComplete="off"
        style={{
          minHeight: 44,
          padding: 'var(--spacing-xs) var(--spacing-sm)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg)',
          color: 'var(--color-fg)',
          fontSize: 'var(--font-size-md)',
        }}
      />
      {/* Always mounted, never conditionally rendered: an assistive technology
          cannot announce a live region that appears at the same moment as its
          first message. Same rule the board's alert region follows. */}
      <p
        id={`${baseId}-status`}
        role="status"
        style={{
          margin: 0,
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-fg-muted)',
        }}
      >
        {formatMessage(LANG, messageKey)}
      </p>
      <ul
        id={listId}
        role="listbox"
        aria-label={label}
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: open ? 'grid' : 'none',
          gap: 2,
          border: open ? '1px solid var(--color-border)' : 'none',
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-bg-surface)',
        }}
      >
        {suggestions.map((suggestion, index) => (
          <li
            key={suggestion.placeId}
            id={`${baseId}-option-${index}`}
            role="option"
            aria-selected={index === activeIndex}
            // Mouse users get the same affordance; `onMouseDown` rather than
            // `onClick` so the input does not blur the popup shut first.
            onMouseDown={(event) => {
              event.preventDefault();
              select(suggestion);
            }}
            style={{
              minHeight: 44,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              padding: 'var(--spacing-xs) var(--spacing-sm)',
              cursor: 'pointer',
              background:
                index === activeIndex
                  ? 'var(--color-bg-subtle)'
                  : 'transparent',
            }}
          >
            <span style={{ fontSize: 'var(--font-size-md)' }}>
              {suggestion.primaryText}
            </span>
            <span
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-fg-muted)',
              }}
            >
              {suggestion.secondaryText}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
