'use client';

import {
  adminVehicleUpdateSchema,
  formatMessage,
  normalizePlate,
  RIDE_CATEGORIES,
  type AdminVehicleUpdate,
  type Language,
  type RideCategory,
  type Vehicle,
} from '@taxi/shared';
import { useRef, useState } from 'react';
import { DialogShell, dialogButtonStyle } from '@/features/override';
import { CATEGORY_LABEL } from './approval-labels';
import {
  alertStyle,
  checkRowStyle,
  fieldStyle,
  fieldsetStyle,
  inputStyle,
  statusStyle,
} from './form-styles';
import type { Outcome } from './use-drivers';

const LANG: Language = 'lv';
const t = (key: Parameters<typeof formatMessage>[1]) => formatMessage(LANG, key);

/**
 * One car, every field editable — `category` included, because the pricing
 * tier is the admin's to set (#20) and this is the only place it is set.
 * Fields are held as strings and validated against the shared admin schema on
 * save, so the form cannot accept what the api would refuse. A save sends only
 * the fields the admin changed: the editor is filled once, so a full body would
 * write back a plate the driver has since changed in the app.
 */
export function VehicleEditor({
  vehicle,
  busy,
  onSave,
  onDelete,
}: Readonly<{
  vehicle: Vehicle;
  busy: boolean;
  onSave: (patch: AdminVehicleUpdate) => Promise<Outcome>;
  onDelete: () => Promise<Outcome>;
}>) {
  const [plate, setPlate] = useState(vehicle.plate);
  const [make, setMake] = useState(vehicle.make);
  const [model, setModel] = useState(vehicle.model);
  const [year, setYear] = useState(String(vehicle.year));
  const [category, setCategory] = useState<RideCategory>(vehicle.category);
  const [seats, setSeats] = useState(String(vehicle.passengerSeats));
  const [childSeat, setChildSeat] = useState(vehicle.hasChildSeat);
  const [feedback, setFeedback] = useState<Outcome | null>(null);
  const [confirming, setConfirming] = useState(false);
  // The form as filled, then as last saved: what "changed" is measured against.
  // Not the `vehicle` prop, which a reload can move under an unchanged field.
  const form = { plate, make, model, year, category, seats, childSeat };
  const saved = useRef(form);

  const idOf = (field: string) => `vehicle-${vehicle.id}-${field}`;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const was = saved.current;
    const patch = {
      ...(plate !== was.plate ? { plate: normalizePlate(plate) } : {}),
      ...(make !== was.make ? { make: make.trim() } : {}),
      ...(model !== was.model ? { model: model.trim() } : {}),
      ...(year !== was.year ? { year: Number(year) } : {}),
      ...(category !== was.category ? { category } : {}),
      ...(seats !== was.seats ? { passengerSeats: Number(seats) } : {}),
      ...(childSeat !== was.childSeat ? { hasChildSeat: childSeat } : {}),
    };
    // Nothing changed: nothing to send (the schema refuses an empty patch).
    if (Object.keys(patch).length === 0) {
      setFeedback({ ok: true });
      return;
    }
    const parsed = adminVehicleUpdateSchema.safeParse(patch);
    if (!parsed.success) {
      setFeedback({ ok: false, key: 'admin.error.invalid_input' });
      return;
    }
    const outcome = await onSave(parsed.data);
    if (outcome.ok) {
      // The field shows the plate as stored, and is measured against that.
      const stored = parsed.data.plate ?? plate;
      setPlate(stored);
      saved.current = { ...form, plate: stored };
    }
    setFeedback(outcome);
  }

  async function confirmDelete() {
    const outcome = await onDelete();
    // On success this editor unmounts with the refetch; on failure the
    // dialog closes and the reason shows beside the car it concerns.
    setConfirming(false);
    if (!outcome.ok) setFeedback(outcome);
  }

  const text = (
    field: string,
    label: Parameters<typeof t>[0],
    value: string,
    set: (v: string) => void,
    extra: React.InputHTMLAttributes<HTMLInputElement> = {},
  ) => (
    <label htmlFor={idOf(field)} style={fieldStyle}>
      {t(label)}
      <input
        id={idOf(field)}
        value={value}
        onChange={(e) => set(e.target.value)}
        style={inputStyle}
        {...extra}
      />
    </label>
  );

  return (
    <form onSubmit={save} style={fieldsetStyle} aria-label={vehicle.plate}>
      <div
        style={{
          display: 'grid',
          gap: 'var(--spacing-sm)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        }}
      >
        {text('plate', 'admin.vehicle.plate', plate, setPlate, { required: true })}
        {text('make', 'admin.vehicle.make', make, setMake, { required: true })}
        {text('model', 'admin.vehicle.model', model, setModel, { required: true })}
        {text('year', 'admin.vehicle.year', year, setYear, { inputMode: 'numeric' })}
        <label htmlFor={idOf('category')} style={fieldStyle}>
          {t('admin.vehicle.category')}
          <select
            id={idOf('category')}
            value={category}
            onChange={(e) => setCategory(e.target.value as RideCategory)}
            style={inputStyle}
          >
            {RIDE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(CATEGORY_LABEL[c])}
              </option>
            ))}
          </select>
        </label>
        {text('seats', 'admin.vehicle.seats', seats, setSeats, { inputMode: 'numeric' })}
      </div>
      <label style={checkRowStyle}>
        <input
          type="checkbox"
          checked={childSeat}
          onChange={(e) => setChildSeat(e.target.checked)}
        />
        {t('admin.vehicle.child_seat')}
      </label>

      <p role="status" style={statusStyle}>
        {feedback?.ok === true ? t('admin.saved') : ''}
      </p>
      {feedback?.ok === false && (
        <p role="alert" style={alertStyle}>
          {t(feedback.key)}
        </p>
      )}

      <div style={{ display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap' }}>
        <button type="submit" disabled={busy} style={dialogButtonStyle('primary')}>
          {t('admin.action.save')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirming(true)}
          style={dialogButtonStyle('danger')}
        >
          {t('admin.vehicle.delete')}
        </button>
      </div>

      {confirming && (
        <DialogShell
          title={formatMessage(LANG, 'admin.vehicle.delete_confirm', {
            plate: vehicle.plate,
          })}
          onClose={() => setConfirming(false)}
        >
          <div style={{ display: 'flex', gap: 'var(--spacing-sm)', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              style={dialogButtonStyle('secondary')}
            >
              {t('admin.vehicle.delete_cancel')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void confirmDelete()}
              style={dialogButtonStyle('danger')}
            >
              {t('admin.vehicle.delete')}
            </button>
          </div>
        </DialogShell>
      )}
    </form>
  );
}
