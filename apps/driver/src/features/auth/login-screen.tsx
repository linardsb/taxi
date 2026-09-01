import {
  colors,
  fontSize,
  otpRequestResponseSchema,
  type MessageKey,
} from '@taxi/shared';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Button, Screen, TextField } from '@/components';
import { errorMessageKey, useT } from '@/features/i18n';
import { ApiError } from './api-client';
import { normalisePhone } from './phone-normalise';
import { useSession } from './use-session';

/**
 * Step 1 of sign-in: the phone. The button is live only once the number
 * normalises to E.164; a 429 `resend_too_soon` turns it into a countdown
 * from the api's `retryAfterSeconds`.
 */
export function LoginScreen() {
  const t = useT();
  const router = useRouter();
  const { api } = useSession();
  const [phone, setPhone] = useState('+371');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const normalised = normalisePhone(phone);

  const coolingDown = cooldown > 0;
  useEffect(() => {
    if (!coolingDown) return;
    const timer = setInterval(
      () => setCooldown((s) => (s <= 1 ? 0 : s - 1)),
      1000,
    );
    return () => clearInterval(timer);
  }, [coolingDown]);

  async function submit() {
    if (!normalised) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.request('POST', '/auth/otp/request', {
        body: { phone: normalised, role: 'driver' },
        schema: otpRequestResponseSchema,
      });
      router.push({
        pathname: '/verify',
        params: {
          phone: normalised,
          resendAfterSeconds: String(res.resendAfterSeconds),
        },
      });
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setError(errorMessageKey(err?.code ?? 'generic'));
      if (err?.retryAfterSeconds) setCooldown(err.retryAfterSeconds);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.title} accessibilityRole="header">
        {t('driver.login.title')}
      </Text>
      <TextField
        label={t('driver.login.phone_label')}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        autoFocus
        editable={!busy}
        error={error ? t(error) : null}
      />
      <Button
        label={
          cooldown > 0
            ? t('driver.verify.resend_in', { seconds: cooldown })
            : t('driver.login.send_code')
        }
        onPress={() => void submit()}
        disabled={!normalised || cooldown > 0}
        loading={busy}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: '700', color: colors.fg },
});
