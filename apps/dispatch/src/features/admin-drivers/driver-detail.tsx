'use client';

import {
  DRIVER_APPROVAL_STATUSES,
  formatMessage,
  type DriverApprovalStatus,
  type Language,
} from '@taxi/shared';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { dialogButtonStyle } from '@/features/override';
import { APPROVAL_ACTION, APPROVAL_LABEL } from './approval-labels';
import { alertStyle, fieldsetStyle, statusStyle } from './form-styles';
import { ProfileForm } from './profile-form';
import { useDriverDetail, type Outcome } from './use-drivers';
import { VehicleEditor } from './vehicle-editor';

const LANG: Language = 'lv';
const t = (key: Parameters<typeof formatMessage>[1]) => formatMessage(LANG, key);

const sectionHeading: React.CSSProperties = {
  margin: 0,
  fontSize: 'var(--font-size-lg)',
};

/** One driver (#20): approval, profile, and every car they registered. */
export function DriverDetail({
  id,
  backHref,
}: Readonly<{ id: string; /** The list, with the filter the admin came from. */ backHref: string }>) {
  const { detail, busy, retry, saveProfile, moveTo, saveVehicle, removeVehicle } =
    useDriverDetail(id);
  const [approvalFeedback, setApprovalFeedback] = useState<Outcome | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const approvalHeading = useRef<HTMLHeadingElement>(null);
  // Set by a successful delete or approval change: the button that had focus
  // (the deleted car's, or the status just chosen, which is no longer offered)
  // is gone only once the new detail renders, so focus moves then.
  const focusOnRender = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    const target = focusOnRender.current;
    if (target === null) return;
    focusOnRender.current = null;
    target.focus();
  }, [detail, approvalFeedback]);

  const back = (
    <Link
      href={backHref}
      style={{
        ...dialogButtonStyle('secondary'),
        display: 'inline-flex',
        alignItems: 'center',
        justifySelf: 'start',
        textDecoration: 'none',
      }}
    >
      {t('admin.action.back')}
    </Link>
  );

  if (detail === 'loading') {
    return (
      <section style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
        {back}
        <p role="status" style={statusStyle}>
          {t('console.loading')}
        </p>
      </section>
    );
  }

  if ('error' in detail) {
    return (
      <section style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
        {back}
        <p role="alert" style={alertStyle}>
          {t(detail.error)}
        </p>
        <button
          type="button"
          onClick={retry}
          style={{ ...dialogButtonStyle('secondary'), justifySelf: 'start' }}
        >
          {t('admin.action.retry')}
        </button>
      </section>
    );
  }

  async function decide(to: DriverApprovalStatus) {
    setApprovalFeedback(null);
    const outcome = await moveTo(to);
    if (outcome.ok) focusOnRender.current = approvalHeading.current;
    setApprovalFeedback(outcome);
  }

  return (
    <section style={{ display: 'grid', gap: 'var(--spacing-lg)', maxWidth: 880 }}>
      {back}
      <div style={{ display: 'grid', gap: 'var(--spacing-xs)' }}>
        <h1
          ref={heading}
          tabIndex={-1}
          style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}
        >
          {detail.displayName ?? t('admin.drivers.no_name')}
        </h1>
        <p style={statusStyle}>{detail.phone}</p>
      </div>

      <section aria-labelledby="approval-heading" style={fieldsetStyle}>
        <h2 id="approval-heading" ref={approvalHeading} tabIndex={-1} style={sectionHeading}>
          {t('admin.driver.approval')}: {t(APPROVAL_LABEL[detail.approvalStatus])}
        </h2>
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap' }}>
          {DRIVER_APPROVAL_STATUSES.filter((s) => s !== detail.approvalStatus).map(
            (to) => (
              <button
                key={to}
                type="button"
                disabled={busy}
                onClick={() => void decide(to)}
                style={dialogButtonStyle(to === 'approved' ? 'primary' : 'secondary')}
              >
                {t(APPROVAL_ACTION[to])}
              </button>
            ),
          )}
        </div>
        <p role="status" style={statusStyle}>
          {approvalFeedback?.ok === true ? t('admin.saved') : ''}
        </p>
        {approvalFeedback?.ok === false && (
          <p role="alert" style={alertStyle}>
            {t(approvalFeedback.key)}
          </p>
        )}
      </section>

      <section aria-labelledby="profile-heading" style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
        <h2 id="profile-heading" style={sectionHeading}>
          {t('admin.driver.profile')}
        </h2>
        <ProfileForm detail={detail} busy={busy} onSave={saveProfile} />
      </section>

      <section aria-labelledby="vehicles-heading" style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
        <h2 id="vehicles-heading" style={sectionHeading}>
          {t('admin.driver.vehicles')}
        </h2>
        {detail.vehicles.length === 0 && (
          <p style={statusStyle}>{t('admin.drivers.no_vehicles')}</p>
        )}
        {detail.vehicles.map((vehicle) => (
          <VehicleEditor
            key={vehicle.id}
            vehicle={vehicle}
            busy={busy}
            onSave={(patch) => saveVehicle(vehicle.id, patch)}
            onDelete={async () => {
              const outcome = await removeVehicle(vehicle.id);
              if (outcome.ok) focusOnRender.current = heading.current;
              return outcome;
            }}
          />
        ))}
      </section>
    </section>
  );
}
