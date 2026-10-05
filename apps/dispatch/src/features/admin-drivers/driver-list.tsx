'use client';

import {
  DRIVER_APPROVAL_STATUSES,
  formatMessage,
  type AdminDriverSummary,
  type DriverApprovalStatus,
  type Language,
} from '@taxi/shared';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { dialogButtonStyle } from '@/features/override';
import {
  APPROVAL_ACTION,
  APPROVAL_LABEL,
  CATEGORY_LABEL,
  EMPTY_LIST,
} from './approval-labels';
import {
  alertStyle,
  checkRowStyle,
  fieldsetStyle,
  statusStyle,
} from './form-styles';
import { useDriverList, type Outcome } from './use-drivers';

const LANG: Language = 'lv';
const t = (key: Parameters<typeof formatMessage>[1]) => formatMessage(LANG, key);

/** The review decisions a row offers: the two terminal statuses it is not in. */
const ROW_ACTIONS: readonly DriverApprovalStatus[] = ['approved', 'rejected'];

const cellStyle: React.CSSProperties = {
  padding: 'var(--spacing-sm)',
  borderBottom: '1px solid var(--color-border)',
  textAlign: 'left',
  verticalAlign: 'middle',
};

const registeredOf = (date: Date) =>
  date.toLocaleDateString('lv-LV', { timeZone: 'Europe/Riga' });

/**
 * The review queue (#20): one tap per decision, the plate and category on the
 * row so the admin decides without opening the driver. The filter is the
 * caller's (it lives in the URL), so returning from a driver keeps it.
 */
export function DriverList({
  filter,
  onFilterChange,
}: Readonly<{
  filter: DriverApprovalStatus;
  onFilterChange: (next: DriverApprovalStatus) => void;
}>) {
  const { drivers, busy, retry, moveTo } = useDriverList(filter);
  const [feedback, setFeedback] = useState<Outcome | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  async function decide(driver: AdminDriverSummary, to: DriverApprovalStatus) {
    setFeedback(null);
    const outcome = await moveTo(driver.userId, to);
    setFeedback(outcome);
    // The row just left the list and took the focused button with it; park
    // focus on the heading so the next Tab starts from the top of the queue.
    if (outcome.ok) heading.current?.focus();
  }

  return (
    <section style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
      <h1
        ref={heading}
        tabIndex={-1}
        style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}
      >
        {t('admin.drivers.title')}
      </h1>

      <fieldset style={{ ...fieldsetStyle, display: 'flex', flexWrap: 'wrap' }}>
        <legend>{t('admin.drivers.filter')}</legend>
        {DRIVER_APPROVAL_STATUSES.map((status) => (
          <label key={status} style={checkRowStyle}>
            <input
              type="radio"
              name="approval"
              value={status}
              checked={filter === status}
              onChange={() => {
                setFeedback(null);
                onFilterChange(status);
              }}
            />
            {t(APPROVAL_LABEL[status])}
          </label>
        ))}
      </fieldset>

      <p role="status" style={statusStyle}>
        {feedback?.ok === true ? t('admin.saved') : ''}
      </p>
      {feedback?.ok === false && (
        <p role="alert" style={alertStyle}>
          {t(feedback.key)}
        </p>
      )}

      {drivers === 'loading' && (
        <p role="status" style={statusStyle}>
          {t('console.loading')}
        </p>
      )}

      {drivers === 'error' && (
        <div style={{ display: 'flex', gap: 'var(--spacing-md)', alignItems: 'center' }}>
          <p role="alert" style={alertStyle}>
            {t('admin.drivers.load_failed')}
          </p>
          <button type="button" onClick={retry} style={dialogButtonStyle('secondary')}>
            {t('admin.action.retry')}
          </button>
        </div>
      )}

      {Array.isArray(drivers) && drivers.length === 0 && (
        <p style={statusStyle}>{t(EMPTY_LIST[filter])}</p>
      )}

      {Array.isArray(drivers) && drivers.length > 0 && (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <caption style={{ textAlign: 'left', paddingBottom: 'var(--spacing-sm)' }}>
            {t(APPROVAL_LABEL[filter])}
          </caption>
          <thead>
            <tr>
              <th scope="col" style={cellStyle}>{t('admin.drivers.col_name')}</th>
              <th scope="col" style={cellStyle}>{t('admin.drivers.col_phone')}</th>
              <th scope="col" style={cellStyle}>{t('admin.drivers.col_vehicles')}</th>
              <th scope="col" style={cellStyle}>{t('admin.drivers.col_registered')}</th>
              <th scope="col" style={cellStyle}>{t('admin.drivers.col_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {drivers.map((driver) => {
              // Every row repeats the same button names; the name cell is
              // each button's description, so a screen reader hears whose.
              const nameId = `driver-name-${driver.userId}`;
              return (
                <tr key={driver.userId}>
                  <th scope="row" id={nameId} style={cellStyle}>
                    {driver.displayName ?? t('admin.drivers.no_name')}
                  </th>
                  <td style={cellStyle}>{driver.phone}</td>
                  <td style={cellStyle}>
                    {driver.vehicles.length === 0
                      ? t('admin.drivers.no_vehicles')
                      : driver.vehicles
                          .map((v) => `${v.plate} · ${t(CATEGORY_LABEL[v.category])}`)
                          .join(', ')}
                  </td>
                  <td style={cellStyle}>{registeredOf(driver.createdAt)}</td>
                  <td style={cellStyle}>
                    <div style={{ display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap' }}>
                      {ROW_ACTIONS.filter((to) => to !== driver.approvalStatus).map((to) => (
                        <button
                          key={to}
                          type="button"
                          disabled={busy}
                          aria-describedby={nameId}
                          onClick={() => void decide(driver, to)}
                          style={dialogButtonStyle(to === 'approved' ? 'primary' : 'secondary')}
                        >
                          {t(APPROVAL_ACTION[to])}
                        </button>
                      ))}
                      <Link
                        // The filter rides along, so the detail's Back returns to it.
                        href={`/admin/drivers?approval=${filter}&id=${encodeURIComponent(driver.userId)}`}
                        aria-describedby={nameId}
                        style={{
                          ...dialogButtonStyle('secondary'),
                          display: 'inline-flex',
                          alignItems: 'center',
                          textDecoration: 'none',
                        }}
                      >
                        {t('admin.action.open')}
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
