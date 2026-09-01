import { colors, fontSize, spacing, type MessageKey } from '@taxi/shared';
import { useRouter } from 'expo-router';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Banner, Button, Screen, type BannerProps } from '@/components';
import { useSession } from '@/features/auth';
import { useT, type T } from '@/features/i18n';
import { useMe } from '@/features/onboarding';
import { EarningsCard } from './earnings-card';
import {
  pillFrom,
  type Connection,
  type PresenceState,
} from './presence-state';
import { usePresence } from './use-presence';

const PILL_KEY: Record<Connection, MessageKey> = {
  live: 'driver.home.pill_live',
  reconnecting: 'driver.home.pill_reconnecting',
  offline: 'driver.home.pill_offline',
};

/** `HH:MM` on the device clock — the banner's «atzīmēts kā bezsaistē 14:32». */
function clockTime(iso: string | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The online screen. One 56 px toggle, the today card, a diagnostics line
 * and at most one banner — each banner carries the one thing to do about it.
 */
export function HomeScreen() {
  const t = useT();
  const router = useRouter();
  const { signOut } = useSession();
  const { me } = useMe();
  const { state, nowMs, toggle, dismissBanner, batteryPrompt } = usePresence();
  const online = state.intent === 'online';
  const pill = pillFrom(state, nowMs);
  const vehicle = me?.vehicles[0];
  const banner = bannerFor(state, t, {
    goOnline: toggle,
    openSettings: () => void Linking.openSettings(),
    addVehicle: () => router.push('/onboarding/vehicle'),
    battery: batteryPrompt,
    dismiss: dismissBanner,
  });

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <Text style={styles.status} accessibilityRole="header">
          {t(
            online ? 'driver.home.status_online' : 'driver.home.status_offline',
          )}
        </Text>
        {pill ? (
          <Text style={styles.pill} testID="pill">
            {t(PILL_KEY[pill])}
          </Text>
        ) : null}
      </View>
      {banner ? <Banner {...banner} testID="banner" /> : null}
      <Button
        size="lg"
        accessibilityRole="switch"
        accessibilityState={{ checked: online }}
        label={t(online ? 'driver.home.go_offline' : 'driver.home.go_online')}
        onPress={toggle}
        loading={state.busy}
        variant={online ? 'secondary' : 'primary'}
        testID="toggle"
      />
      <EarningsCard online={online} />
      {online ? (
        <Text style={styles.diagnostics} testID="diagnostics">
          {state.lastFixAt === null
            ? t('driver.home.queued', { count: state.queued })
            : `${t('driver.home.last_fix', {
                seconds: Math.max(
                  0,
                  Math.round((nowMs - state.lastFixAt) / 1000),
                ),
              })} · ${t('driver.home.queued', { count: state.queued })}`}
        </Text>
      ) : null}
      <View style={styles.footer}>
        {vehicle ? (
          <Button
            variant="secondary"
            label={t('driver.home.vehicle', { plate: vehicle.plate })}
            onPress={() =>
              router.push({
                pathname: '/onboarding/vehicle',
                params: { vehicleId: vehicle.id },
              })
            }
          />
        ) : (
          <Button
            variant="secondary"
            label={t('driver.action.add_vehicle')}
            onPress={() => router.push('/onboarding/vehicle')}
          />
        )}
        <Button
          variant="danger"
          label={t('driver.action.sign_out')}
          onPress={() => void signOut()}
        />
      </View>
    </Screen>
  );
}

function bannerFor(
  state: PresenceState,
  t: T,
  act: {
    goOnline: () => void;
    openSettings: () => void;
    addVehicle: () => void;
    battery: (open: boolean) => void;
    dismiss: () => void;
  },
): Omit<BannerProps, 'testID'> | null {
  const b = state.banner;
  if (!b) return null;
  switch (b.kind) {
    case 'marked_offline':
      return {
        tone: 'warning',
        text: t('driver.home.marked_offline', { time: clockTime(b.at) }),
        action: { label: t('driver.home.go_online'), onPress: act.goOnline },
      };
    case 'foreground_denied':
      return {
        tone: 'danger',
        text: t('driver.permission.foreground_denied'),
        action: {
          label: t('driver.action.open_settings'),
          onPress: act.openSettings,
        },
      };
    case 'background_denied':
      return {
        tone: 'warning',
        text: t('driver.permission.background_body'),
        action: {
          label: t('driver.action.open_settings'),
          onPress: act.openSettings,
        },
        secondary: { label: t('driver.action.skip'), onPress: act.dismiss },
      };
    case 'vehicle_required':
      return {
        tone: 'danger',
        text: t('driver.error.vehicle_required'),
        action: {
          label: t('driver.action.add_vehicle'),
          onPress: act.addVehicle,
        },
      };
    case 'driver_on_ride':
      return { tone: 'info', text: t('driver.error.driver_on_ride') };
    case 'battery':
      return {
        tone: 'info',
        text: t('driver.permission.battery_body'),
        action: {
          label: t('driver.action.open_settings'),
          onPress: () => act.battery(true),
        },
        secondary: {
          label: t('driver.action.skip'),
          onPress: () => act.battery(false),
        },
      };
    case 'generic':
      return {
        tone: 'danger',
        text: t('driver.error.generic'),
        action: { label: t('driver.action.retry'), onPress: act.dismiss },
      };
  }
}

const styles = StyleSheet.create({
  header: { gap: spacing.xs },
  status: { fontSize: fontSize.xl, fontWeight: '700', color: colors.fg },
  pill: { fontSize: fontSize.sm, color: colors.fgMuted },
  diagnostics: { fontSize: fontSize.sm, color: colors.fgMuted },
  footer: { marginTop: 'auto', gap: spacing.sm },
});
