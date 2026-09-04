import {
  authSessionSchema,
  colors,
  fontSize,
  otpRequestResponseSchema,
  type MessageKey,
} from '@taxi/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import {
  Banner,
  Button,
  Screen,
  TextField,
  useScreenFocus,
} from '@/components';
import { errorMessageKey, useT } from '@/features/i18n';
import { ApiError } from './api-client';
import { useSession } from './use-session';

const CODE_LENGTH = 6;
const DEFAULT_RESEND_SECONDS = 60;

/**
 * Step 2 of sign-in: the code. Auto-submits on the sixth digit (zero taps);
 * a 401 clears the field, says so, and hands focus back. The OTP is never
 * rendered anywhere but the field the rider is typing into.
 *
 * `phone` IS OPTIONAL AT RUNTIME, whatever the route intends. `app.json` sets
 * `"scheme": "saktacabrider"`, so `saktacabrider://verify` opens this screen
 * with no params at all — and `formatMessage` treats a present-but-undefined
 * key as present (`'phone' in { phone: undefined }` is `true`), so typing it as
 * required rendered «Kods nosūtīts uz undefined» and posted
 * `{ phone: undefined }` to a 400 on every attempt. `status-screen.tsx` gets
 * this shape right; this matches it.
 */
export function VerifyScreen() {
  const t = useT();
  const router = useRouter();
  const { api, signIn } = useSession();
  const heading = useRef<Text>(null);
  useScreenFocus(heading);
  const params = useLocalSearchParams<{
    phone?: string;
    resendAfterSeconds?: string;
  }>();
  const phone = params.phone ?? null;
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [resendIn, setResendIn] = useState(
    Number(params.resendAfterSeconds) || DEFAULT_RESEND_SECONDS,
  );
  const input = useRef<TextInput>(null);

  const counting = resendIn > 0;
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(
      () => setResendIn((s) => (s <= 1 ? 0 : s - 1)),
      1000,
    );
    return () => clearInterval(timer);
  }, [counting]);

  const submit = useCallback(
    async (value: string) => {
      if (phone === null) return;
      setBusy(true);
      setError(null);
      try {
        const session = await api.request('POST', '/auth/otp/verify', {
          body: { phone, code: value },
          schema: authSessionSchema,
        });
        await signIn(session);
        router.replace('/');
      } catch (e) {
        const err = e instanceof ApiError ? e : null;
        setCode('');
        setError(errorMessageKey(err?.code ?? 'generic'));
        input.current?.focus();
      } finally {
        setBusy(false);
      }
    },
    [api, phone, router, signIn],
  );

  function onChange(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, CODE_LENGTH);
    setCode(digits);
    if (digits.length === CODE_LENGTH && !busy) void submit(digits);
  }

  async function resend() {
    if (phone === null) return;
    setError(null);
    try {
      const res = await api.request('POST', '/auth/otp/request', {
        body: { phone, role: 'rider' },
        schema: otpRequestResponseSchema,
      });
      setResendIn(res.resendAfterSeconds || DEFAULT_RESEND_SECONDS);
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setError(errorMessageKey(err?.code ?? 'generic'));
      if (err?.retryAfterSeconds) setResendIn(err.retryAfterSeconds);
    }
  }

  return (
    <Screen>
      <Text ref={heading} style={styles.title} accessibilityRole="header">
        {t('rider.verify.title')}
      </Text>
      {phone === null ? (
        // Nothing to verify against, so nothing is claimed. The alternative was
        // a hint reading «Kods nosūtīts uz undefined».
        <Banner tone="danger" text={t('rider.error.generic')} />
      ) : (
        <Text style={styles.hint}>{t('rider.verify.hint', { phone })}</Text>
      )}
      <TextField
        ref={input}
        label={t('rider.verify.code_label')}
        value={code}
        onChangeText={onChange}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={CODE_LENGTH}
        autoFocus
        editable={!busy && phone !== null}
        error={error ? t(error) : null}
      />
      <Button
        label={
          resendIn > 0
            ? t('rider.verify.resend_in', { seconds: resendIn })
            : t('rider.verify.resend')
        }
        onPress={() => void resend()}
        disabled={resendIn > 0 || busy || phone === null}
        variant="secondary"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: '700', color: colors.fg },
  hint: { fontSize: fontSize.md, color: colors.fgMuted },
});
