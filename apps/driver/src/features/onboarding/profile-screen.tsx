import {
  LANGUAGES,
  colors,
  fontSize,
  radius,
  spacing,
  type DriverProfileUpdate,
  type Language,
  type MessageKey,
} from '@taxi/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Banner, Button, Screen } from '@/components';
import { useLanguage, useT } from '@/features/i18n';
import { useMe } from './use-me';

const LANG_KEY: Record<Language, MessageKey> = {
  lv: 'driver.lang.lv',
  ru: 'driver.lang.ru',
  en: 'driver.lang.en',
};

/**
 * Onboarding step 1: the two attributes dispatch filters riders by. The
 * device language joins the preselection so a Russian-speaking driver on a
 * fresh (`['lv']`) profile starts with both. Saves ONLY what changed — an
 * empty patch is a 400 by the schema's refine.
 */
export function ProfileScreen() {
  const t = useT();
  const router = useRouter();
  const device = useLanguage();
  const { me, patchProfile } = useMe();
  const stored = me?.profile.spokenLanguages ?? ['lv'];
  const [langs, setLangs] = useState<Language[]>(() =>
    stored.includes(device) ? [...stored] : [...stored, device],
  );
  const [female, setFemale] = useState(me?.profile.isFemale ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  function toggle(lang: Language) {
    setLangs((current) =>
      current.includes(lang)
        ? current.filter((l) => l !== lang)
        : [...current, lang],
    );
  }

  async function next() {
    const patch: DriverProfileUpdate = {};
    const sameLangs =
      langs.length === stored.length && langs.every((l) => stored.includes(l));
    if (!sameLangs) patch.spokenLanguages = langs;
    if (female !== (me?.profile.isFemale ?? false)) patch.isFemale = female;
    if (Object.keys(patch).length === 0) {
      router.push('/onboarding/vehicle');
      return;
    }
    setBusy(true);
    setError(false);
    try {
      await patchProfile(patch);
      router.push('/onboarding/vehicle');
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.title} accessibilityRole="header">
        {t('driver.profile.title')}
      </Text>
      <Text style={styles.label}>{t('driver.profile.languages')}</Text>
      <View style={styles.chips}>
        {LANGUAGES.map((lang) => (
          <LanguageChip
            key={lang}
            label={t(LANG_KEY[lang])}
            checked={langs.includes(lang)}
            onPress={() => toggle(lang)}
          />
        ))}
      </View>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>{t('driver.profile.female_driver')}</Text>
        <Switch
          value={female}
          onValueChange={setFemale}
          accessibilityLabel={t('driver.profile.female_driver')}
          trackColor={{ true: colors.accent, false: colors.border }}
        />
      </View>
      {error ? <Banner tone="danger" text={t('driver.error.generic')} /> : null}
      <Button
        label={t('driver.action.continue')}
        onPress={() => void next()}
        disabled={langs.length === 0}
        loading={busy}
      />
    </Screen>
  );
}

/** A ≥44 px checkbox chip with a visible focus ring (the Button's `colors.fg` outline — visible on the checked, accent-filled chip too). */
function LanguageChip({
  label,
  checked,
  onPress,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onPress}
      focusable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.chip,
        checked && styles.chipChecked,
        focused && styles.focused,
      ]}
    >
      <Text style={[styles.chipText, checked && styles.chipTextChecked]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: '700', color: colors.fg },
  label: { fontSize: fontSize.sm, color: colors.fgMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSurface,
  },
  chipChecked: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: fontSize.md, color: colors.fg },
  chipTextChecked: { color: colors.accentFg },
  focused: { outlineWidth: 2, outlineColor: colors.fg, outlineOffset: 2 },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rowLabel: { flex: 1, fontSize: fontSize.md, color: colors.fg },
});
