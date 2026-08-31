import { colors, fontSize } from '@taxi/shared';
import { useRouter } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { Button, Screen } from '@/components';
import { useT } from '@/features/i18n';

/**
 * Onboarding step 3 — a stub, deliberately: document upload and approval
 * are #20's. One screen so the driver learns approval is coming rather than
 * being surprised by it.
 */
export function DocumentsScreen() {
  const t = useT();
  const router = useRouter();
  return (
    <Screen>
      <Text style={styles.title} accessibilityRole="header">
        {t('driver.documents.title')}
      </Text>
      <Text style={styles.body}>{t('driver.documents.body')}</Text>
      <Button
        label={t('driver.action.done')}
        onPress={() => router.replace('/home')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: '700', color: colors.fg },
  body: { fontSize: fontSize.md, color: colors.fg },
});
