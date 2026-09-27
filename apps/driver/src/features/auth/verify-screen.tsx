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
import { Button, Screen, TextField } from '@/components';
import { errorMessageKey, useT } from '@/features/i18n';
import { ApiError } from './api-client';
import { useSession } from './use-session';

const CODE_LENGTH = 6;
const DEFAULT_RESEND_SECONDS = 60;

/**
 * Step 2 of sign-in: the code. Auto-submits on the sixth digit (zero taps);
 * a 401 clears the field, says so, and hands focus back. The OTP is never
 * rendered anywhere but the field the driver is typing into.
 */
export function VerifyScreen() {
  const t = useT();
  const router = useRouter();
  const { api, signIn } = useSession();
  const params = useLocalSearchParams<{
    phone: string;
    resendAfterSeconds?: string;
  }>();
  const phone = params.phone;
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
        input.current?.clear();
        setError(errorMessageKey(err?.code ?? 'generic'));
        input.current?.focus();
      } finally {
        setBusy(false);
      }
    },
    [api, phone, router, signIn],
  );

  function onChange(value: string) {
    // Uncontrolled (#287): no `value`, so no per-keystroke native re-set for
    // TalkBack to speak as «tika aizstāts». A non-digit stays visible and never
    // reaches six digits; the error path's `clear()` is the one native write.
    if (value.length === CODE_LENGTH && /^\d+$/.test(value) && !busy)
      void submit(value);
  }

  async function resend() {
    setError(null);
    try {
      const res = await api.request('POST', '/auth/otp/request', {
        body: { phone, role: 'driver' },
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
      <Text style={styles.title} accessibilityRole="header">
        {t('driver.verify.title')}
      </Text>
      <Text style={styles.hint}>{t('driver.verify.hint', { phone })}</Text>
      <TextField
        ref={input}
        label={t('driver.verify.code_label')}
        onChangeText={onChange}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={CODE_LENGTH}
        autoFocus
        editable={!busy}
        error={error ? t(error) : null}
      />
      <Button
        label={
          resendIn > 0
            ? t('driver.verify.resend_in', { seconds: resendIn })
            : t('driver.verify.resend')
        }
        onPress={() => void resend()}
        disabled={resendIn > 0 || busy}
        variant="secondary"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: '700', color: colors.fg },
  hint: { fontSize: fontSize.md, color: colors.fgMuted },
});
