import {
  addressPointSchema,
  addressSuggestionsSchema,
  colors,
  fontSize,
  spacing,
  type AddressSuggestion,
  type MessageKey,
} from '@taxi/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text } from 'react-native';
import {
  Banner,
  Button,
  Screen,
  TextField,
  useScreenFocus,
} from '@/components';
import { ApiError, useSession } from '@/features/auth';
import { errorMessageKey, useT } from '@/features/i18n';
import { newUuid } from '@/uuid';
import { AddressRow } from './address-row';
import { currentPositionPoint } from './current-position';

/**
 * Client-side debounce. The server floor (`PLACES_SEARCH_MIN_CHARS`) and the
 * per-rider rate limit are what BOUND the bill; this only keeps an ordinary
 * typist from paying per keystroke. 300 ms matches the console's and is
 * `expected`, not measured — plan Q5's figure.
 */
const DEBOUNCE_MS = 300;

/**
 * Mirrors the api's `PLACES_SEARCH_MIN_CHARS` default. A deliberate duplicate:
 * the app cannot read the server's env, and below this the api answers `[]`
 * anyway — matching it here saves the round trip rather than deciding anything.
 */
const MIN_CHARS = 3;

export type AddressField = 'pickup' | 'dropoff';

type Status = 'idle' | 'searching' | 'empty' | 'failed';

/** A response, tagged with the query it answered — a late reply for an older
 *  query simply never matches the current one. */
interface Results {
  query: string;
  suggestions: AddressSuggestion[];
  status: 'ok' | 'empty' | 'failed';
}

/**
 * `/book/address` — the whole address-entry surface, and there is no map on it.
 *
 * Map-pin placement is one of the two flows that actually break for blind users
 * (`docs/research/rider-ux-evidence.md` §1.2), so pickup and dropoff are entered
 * exactly the same way: type, hear the suggestions, tap one.
 *
 * The result goes back to `/book` through route params rather than a shared
 * store: `router.navigate` reuses the `/book` already in the stack, so the back
 * button still means "back", and the params are re-parsed through
 * `addressPointSchema` on arrival because a param is a string.
 */
export function SearchSheet() {
  const t = useT();
  const router = useRouter();
  const { api } = useSession();
  const heading = useRef<Text>(null);
  useScreenFocus(heading);
  const params = useLocalSearchParams<{ field?: AddressField }>();
  const field: AddressField = params.field === 'pickup' ? 'pickup' : 'dropoff';

  const [typed, setTyped] = useState('');
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState<string[]>([]);
  const [cooldown, setCooldown] = useState(0);

  /**
   * ONE session token per FIELD VISIT, reused across this field's keystrokes.
   * That is what collapses a burst of autocomplete requests into a single
   * billed session — minting per keystroke would bill each one separately.
   * Rotation is handled at the resolve, and only where the session was actually
   * spent; see `resolve` below.
   */
  const session = useRef(newUuid());

  // A 429 carries `retryAfterSeconds`; the rider is told how long, and the
  // field goes quiet rather than retrying — retrying is what produced it.
  const coolingDown = cooldown > 0;
  useEffect(() => {
    if (!coolingDown) return;
    const timer = setInterval(
      () => setCooldown((s) => (s <= 1 ? 0 : s - 1)),
      1000,
    );
    return () => clearInterval(timer);
  }, [coolingDown]);

  const query = typed.trim();
  const searchable = query.length >= MIN_CHARS && !coolingDown;
  const current = searchable && results?.query === query ? results : null;
  const suggestions = (
    current?.status === 'ok' ? current.suggestions : []
  ).filter((s) => !gone.includes(s.placeId));
  const status: Status = !searchable
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
      void api
        .request(
          'GET',
          `/geo/address-search?q=${encodeURIComponent(query)}&session=${session.current}`,
          {
            schema: addressSuggestionsSchema,
          },
        )
        .then((found) =>
          setResults({
            query,
            suggestions: found,
            status: found.length === 0 ? 'empty' : 'ok',
          }),
        )
        .catch((e: unknown) => {
          const err = e instanceof ApiError ? e : null;
          setError(errorMessageKey(err?.code ?? 'generic'));
          if (err?.retryAfterSeconds) setCooldown(err.retryAfterSeconds);
          setResults({ query, suggestions: [], status: 'failed' });
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [api, query, searchable]);

  function done(
    address: string,
    lat: number,
    lng: number,
    placeId: string | null,
  ) {
    router.navigate({
      pathname: '/book',
      params: {
        field,
        address,
        lat: String(lat),
        lng: String(lng),
        placeId: placeId ?? '',
      },
    });
  }

  async function resolve(suggestion: AddressSuggestion) {
    setBusy(true);
    setError(null);
    try {
      const point = await api.request(
        'POST',
        `/geo/places/${encodeURIComponent(suggestion.placeId)}/resolve`,
        { body: { session: session.current }, schema: addressPointSchema },
      );
      // The session WAS spent — the api reached the provider — so the next
      // search must open a new one.
      session.current = newUuid();
      done(
        point.address,
        point.location.lat,
        point.location.lng,
        suggestion.placeId,
      );
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setError(errorMessageKey(err?.code ?? 'generic'));
      if (err?.retryAfterSeconds) setCooldown(err.retryAfterSeconds);
      if (err?.status === 404) {
        // "This place is gone, search again" — not a generic failure. The row
        // goes, and the token rotates because the provider WAS asked.
        setGone((g) => [...g, suggestion.placeId]);
        session.current = newUuid();
      }
      // A 429 or an offline failure never reached the provider, so the session
      // is still open. Rotating here would ABANDON the session this resolve was
      // about to close — the arithmetic `ADDRESS_RESOLVE_MAX_PER_WINDOW`'s
      // docblock costs out, and the bug the console's `.catch` still has.
    } finally {
      setBusy(false);
    }
  }

  async function fillFromCurrentLocation() {
    setBusy(true);
    setError(null);
    const point = await currentPositionPoint();
    setBusy(false);
    if (point === null) {
      setError('rider.error.generic');
      return;
    }
    done(point.address, point.location.lat, point.location.lng, null);
  }

  return (
    <Screen scroll={false}>
      <Text ref={heading} style={styles.title} accessibilityRole="header">
        {t(
          field === 'pickup'
            ? 'rider.address.title_pickup'
            : 'rider.address.title_dropoff',
        )}
      </Text>
      <TextField
        label={t('rider.address.search_label')}
        value={typed}
        onChangeText={setTyped}
        autoFocus
        editable={!busy}
        autoCorrect={false}
      />
      {error ? (
        <Banner
          tone="danger"
          text={
            coolingDown
              ? `${t(error)} ${t('rider.book.retry_in', { seconds: cooldown })}`
              : t(error)
          }
        />
      ) : null}
      {field === 'pickup' ? (
        <Button
          label={t('rider.book.use_current_location')}
          onPress={() => void fillFromCurrentLocation()}
          variant="secondary"
          disabled={busy}
        />
      ) : null}
      <Text style={styles.status} accessibilityLiveRegion="polite">
        {status === 'idle' && !searchable
          ? t('rider.book.min_chars', { count: MIN_CHARS })
          : status === 'searching'
            ? t('rider.book.searching')
            : status === 'empty'
              ? t('rider.book.no_results')
              : ''}
      </Text>
      <FlatList
        data={suggestions}
        keyExtractor={(s) => s.placeId}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <AddressRow
            primaryText={item.primaryText}
            secondaryText={item.secondaryText}
            onPress={() => void resolve(item)}
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: '700', color: colors.fg },
  status: { fontSize: fontSize.sm, color: colors.fgMuted },
  list: { gap: spacing.xs },
});
