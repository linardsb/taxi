import {
  colors,
  fontSize,
  spacing,
  vehicleCreateSchema,
  type VehicleCreate,
} from '@taxi/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { Banner, Button, Screen, TextField } from '@/components';
import { ApiError } from '@/features/auth';
import { errorMessageKey, useT } from '@/features/i18n';
import { useMe } from './use-me';

type Field = 'plate' | 'make' | 'model' | 'year' | 'passengerSeats';
type FieldErrors = Partial<Record<Field, string>>;

const FIELDS: readonly Field[] = [
  'plate',
  'make',
  'model',
  'year',
  'passengerSeats',
];

/**
 * Onboarding step 2, and the edit form reached from home (`?vehicleId=`).
 * The body is validated through `vehicleCreateSchema` BEFORE the request,
 * so a bad year never leaves the phone. Inner whitespace is stripped from
 * the plate — `AB 1234` and `AB1234` are one car against the `upper(plate)`
 * unique index. `category` has no picker for the pilot (logged in
 * ui-decisions.md): `standard` on create, and on edit the STORED value, so
 * an admin-set tier (#20) survives a driver correcting their plate.
 */
export function VehicleScreen() {
  const t = useT();
  const router = useRouter();
  const { vehicleId } = useLocalSearchParams<{ vehicleId?: string }>();
  const { me, createVehicle, updateVehicle } = useMe();
  const editing = vehicleId
    ? me?.vehicles.find((v) => v.id === vehicleId)
    : undefined;
  const [plate, setPlate] = useState(editing?.plate ?? '');
  const [make, setMake] = useState(editing?.make ?? '');
  const [model, setModel] = useState(editing?.model ?? '');
  const [year, setYear] = useState(editing ? String(editing.year) : '');
  const [seats, setSeats] = useState(
    editing ? String(editing.passengerSeats) : '4',
  );
  const [childSeat, setChildSeat] = useState(editing?.hasChildSeat ?? false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function validate(): VehicleCreate | null {
    const parsed = vehicleCreateSchema.safeParse({
      plate: plate.replace(/\s+/g, '').toUpperCase(),
      make: make.trim(),
      model: model.trim(),
      year: Number(year),
      passengerSeats: Number(seats),
      hasChildSeat: childSeat,
      category: editing?.category ?? 'standard',
    });
    if (parsed.success) {
      setErrors({});
      return parsed.data;
    }
    const next: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (typeof field === 'string' && (FIELDS as string[]).includes(field)) {
        next[field as Field] = t('driver.error.invalid_field');
      }
    }
    setErrors(next);
    return null;
  }

  async function save() {
    const body = validate();
    if (!body) return;
    setBusy(true);
    setBanner(null);
    try {
      if (editing) {
        await updateVehicle(editing.id, body);
        router.back();
      } else {
        await createVehicle(body);
        router.replace('/onboarding/documents');
      }
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err?.code === 'plate_taken') {
        setErrors({ plate: t('driver.error.plate_taken') });
      } else if (err?.status === 400 && err.issues) {
        const next: FieldErrors = {};
        for (const issue of err.issues) {
          const field = issue.path[0];
          if (
            typeof field === 'string' &&
            (FIELDS as string[]).includes(field)
          ) {
            next[field as Field] = t('driver.error.invalid_field');
          }
        }
        setErrors(next);
      } else {
        setBanner(t(errorMessageKey(err?.code ?? 'generic')));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.title} accessibilityRole="header">
        {t('driver.vehicle.title')}
      </Text>
      <TextField
        label={t('driver.vehicle.plate')}
        value={plate}
        onChangeText={setPlate}
        autoCapitalize="characters"
        autoCorrect={false}
        error={errors.plate}
      />
      <TextField
        label={t('driver.vehicle.make')}
        value={make}
        onChangeText={setMake}
        error={errors.make}
      />
      <TextField
        label={t('driver.vehicle.model')}
        value={model}
        onChangeText={setModel}
        error={errors.model}
      />
      <TextField
        label={t('driver.vehicle.year')}
        value={year}
        onChangeText={setYear}
        keyboardType="number-pad"
        maxLength={4}
        error={errors.year}
      />
      <TextField
        label={t('driver.vehicle.seats')}
        value={seats}
        onChangeText={setSeats}
        keyboardType="number-pad"
        maxLength={1}
        error={errors.passengerSeats}
      />
      <View style={styles.row}>
        <Text style={styles.rowLabel}>{t('driver.vehicle.child_seat')}</Text>
        <Switch
          value={childSeat}
          onValueChange={setChildSeat}
          accessibilityLabel={t('driver.vehicle.child_seat')}
          trackColor={{ true: colors.accent, false: colors.border }}
        />
      </View>
      {banner ? <Banner tone="danger" text={banner} /> : null}
      <Button
        label={t('driver.action.save')}
        onPress={() => void save()}
        loading={busy}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: fontSize.xl, fontWeight: '700', color: colors.fg },
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rowLabel: { flex: 1, fontSize: fontSize.md, color: colors.fg },
});
