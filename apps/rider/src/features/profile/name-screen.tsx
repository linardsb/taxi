import {
  colors,
  DISPLAY_NAME_MAX,
  displayNameSchema,
  fontSize,
  type MessageKey,
} from '@taxi/shared';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';
import {
  Banner,
  Button,
  Screen,
  TextField,
  useScreenFocus,
} from '@/components';
import { ApiError, useSession } from '@/features/auth';
import { errorMessageKey, useT } from '@/features/i18n';

/**
 * `/name` — what the driver calls the rider (#269). Optional: a blank Save
 * with no name goes back without a request. The field is uncontrolled (#287),
 * so TalkBack does not speak «aizstāts» on every keystroke; the text lives in
 * a ref and survives an error for the retry.
 *
 * The api answers 204 with no body (D6), so the value this screen parsed
 * through `displayNameSchema` — the api's own parse — is the one mirrored
 * into the session.
 */
export function NameScreen() {
  const t = useT();
  const router = useRouter();
  const { api, state, setDisplayName } = useSession();
  const heading = useRef<Text>(null);
  useScreenFocus(heading);
  const current =
    state.status === 'signedIn'
      ? (state.session.user.displayName ?? null)
      : null;
  const text = useRef(current ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  async function submit(name: string | null) {
    setBusy(true);
    setError(null);
    try {
      await api.request('PUT', '/riders/me/display-name', {
        body: { displayName: name },
      });
      await setDisplayName(name);
      AccessibilityInfo.announceForAccessibility(
        t(name === null ? 'rider.name.removed' : 'rider.name.saved'),
      );
      router.back();
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setError(errorMessageKey(err?.code ?? 'generic'));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (text.current.trim() === '') {
      if (current === null) router.back();
      else void submit(null);
      return;
    }
    const parsed = displayNameSchema.safeParse(text.current);
    // Reachable only through a pasted control character.
    if (!parsed.success) setError('rider.error.generic');
    else void submit(parsed.data);
  }

  return (
    <Screen>
      <Text ref={heading} style={styles.title} accessibilityRole="header">
        {t('rider.name.title')}
      </Text>
      <Text style={styles.hint}>{t('rider.name.hint')}</Text>
      {error ? <Banner tone="danger" text={t(error)} /> : null}
      <TextField
        label={t('rider.name.label')}
        defaultValue={current ?? ''}
        onChangeText={(value) => {
          text.current = value;
        }}
        maxLength={DISPLAY_NAME_MAX}
        autoComplete="name"
        textContentType="givenName"
        autoCapitalize="words"
        editable={!busy}
      />
      <Button label={t('rider.name.save')} onPress={save} loading={busy} />
      {current === null ? null : (
        <Button
          label={t('rider.name.remove')}
          onPress={() => void submit(null)}
          disabled={busy}
          variant="secondary"
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: '700', color: colors.fg },
  hint: { fontSize: fontSize.md, color: colors.fgMuted },
});
