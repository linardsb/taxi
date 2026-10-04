'use client';

import {
  adminDriverUpdateSchema,
  DISPLAY_NAME_MAX,
  formatMessage,
  LANGUAGES,
  type AdminDriverDetail,
  type AdminDriverUpdate,
  type Language,
} from '@taxi/shared';
import { useRef, useState } from 'react';
import { dialogButtonStyle } from '@/features/override';
import { LANGUAGE_LABEL } from './approval-labels';
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
 * The driver's profile as the admin edits it (#20). The commission override has
 * an explicit «platform base» box because `null` (use the base) and `0` (Atis's
 * 0 % pilot deal) are different decisions and must not share an empty field.
 * A save sends only what the admin changed, as the driver app's profile screen
 * does: an unticked female-driver box over a never-answered (`null`) flag is
 * not an answer, and the api writes only the keys it is sent.
 */
export function ProfileForm({
  detail,
  busy,
  onSave,
}: Readonly<{
  detail: AdminDriverDetail;
  busy: boolean;
  onSave: (patch: AdminDriverUpdate) => Promise<Outcome>;
}>) {
  const { profile } = detail;
  const [name, setName] = useState(detail.displayName ?? '');
  const [languages, setLanguages] = useState<readonly Language[]>(
    profile.spokenLanguages,
  );
  const [isFemale, setIsFemale] = useState(profile.isFemale ?? false);
  const [useBase, setUseBase] = useState(profile.commissionPctOverride === null);
  const [pct, setPct] = useState(
    profile.commissionPctOverride === null ? '' : String(profile.commissionPctOverride),
  );
  const [feedback, setFeedback] = useState<Outcome | null>(null);
  // The form as filled, then as last saved: what "changed" is measured against.
  // Not the `detail` prop, which a reload can move under an unchanged field.
  const form = { name, languages, isFemale, useBase, pct };
  const saved = useRef(form);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const was = saved.current;
    const trimmed = name.trim();
    const languagesChanged =
      languages.length !== was.languages.length ||
      languages.some((l) => !was.languages.includes(l));
    const commissionChanged = useBase !== was.useBase || (!useBase && pct !== was.pct);
    if (commissionChanged && !useBase && pct.trim() === '') {
      setFeedback({ ok: false, key: 'admin.error.invalid_input' });
      return;
    }
    const patch = {
      // A name can be set or changed but not cleared (the api has no null
      // for it), so a blank field leaves the stored name alone.
      ...(trimmed !== '' && trimmed !== was.name.trim() ? { displayName: trimmed } : {}),
      ...(languagesChanged ? { spokenLanguages: languages } : {}),
      ...(isFemale !== was.isFemale ? { isFemale } : {}),
      ...(commissionChanged
        ? { commissionPctOverride: useBase ? null : Number(pct.replace(',', '.')) }
        : {}),
    };
    // Nothing changed: nothing to send (the schema refuses an empty patch).
    if (Object.keys(patch).length === 0) {
      setFeedback({ ok: true });
      return;
    }
    const parsed = adminDriverUpdateSchema.safeParse(patch);
    if (!parsed.success) {
      setFeedback({ ok: false, key: 'admin.error.invalid_input' });
      return;
    }
    const outcome = await onSave(parsed.data);
    if (outcome.ok) saved.current = form;
    setFeedback(outcome);
  }

  const toggleLanguage = (lang: Language, on: boolean) =>
    setLanguages((current) =>
      on
        ? LANGUAGES.filter((l) => l === lang || current.includes(l))
        : current.filter((l) => l !== lang),
    );

  return (
    <form
      onSubmit={save}
      // Named, as each car's form is by its plate: the page has one «Saglabāt»
      // per form, and the form landmark says which one a button saves.
      aria-label={t('admin.driver.profile')}
      style={{ display: 'grid', gap: 'var(--spacing-md)' }}
    >
      <label htmlFor="driver-name" style={fieldStyle}>
        {t('admin.driver.display_name')}
        <input
          id="driver-name"
          value={name}
          maxLength={DISPLAY_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          style={inputStyle}
        />
      </label>

      <fieldset style={fieldsetStyle}>
        <legend>{t('admin.driver.languages')}</legend>
        {LANGUAGES.map((lang) => {
          const checked = languages.includes(lang);
          return (
            <label key={lang} style={checkRowStyle}>
              <input
                type="checkbox"
                checked={checked}
                // A driver speaks at least one language (the schema's min 1):
                // the last box ticked cannot be unticked.
                disabled={checked && languages.length === 1}
                onChange={(e) => toggleLanguage(lang, e.target.checked)}
              />
              {t(LANGUAGE_LABEL[lang])}
            </label>
          );
        })}
      </fieldset>

      <label style={checkRowStyle}>
        <input
          type="checkbox"
          checked={isFemale}
          onChange={(e) => setIsFemale(e.target.checked)}
        />
        {t('admin.driver.is_female')}
      </label>

      <fieldset style={fieldsetStyle}>
        <legend>{t('admin.driver.commission_override')}</legend>
        <label style={checkRowStyle}>
          <input
            type="checkbox"
            checked={useBase}
            onChange={(e) => setUseBase(e.target.checked)}
          />
          {t('admin.driver.commission_platform_base')}
        </label>
        <input
          aria-label={t('admin.driver.commission_override')}
          inputMode="decimal"
          value={pct}
          disabled={useBase}
          onChange={(e) => setPct(e.target.value)}
          style={{ ...inputStyle, maxWidth: 160 }}
        />
      </fieldset>

      <p role="status" style={statusStyle}>
        {feedback?.ok === true ? t('admin.saved') : ''}
      </p>
      {feedback?.ok === false && (
        <p role="alert" style={alertStyle}>
          {t(feedback.key)}
        </p>
      )}

      <div>
        <button type="submit" disabled={busy} style={dialogButtonStyle('primary')}>
          {t('admin.action.save')}
        </button>
      </div>
    </form>
  );
}
