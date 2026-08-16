'use client';

import {
  authSessionSchema,
  formatMessage,
  type Language,
  type MessageKey,
} from '@taxi/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { apiUrl } from './api-url';
import { hasConsoleRole, saveSession } from './session';

const LANG: Language = 'lv';

/**
 * OTP sign-in, two steps (phone → code) — the friction-audit minimum of four
 * interactions, no captcha, no extra steps.
 *
 * The request carries `role:'rider'` because `otpRequestSchema` accepts only
 * signup roles — dispatchers are provisioned (provision-dispatcher.ts), and
 * the stored role always wins on an existing row. An UNprovisioned phone
 * therefore silently becomes a rider account; the role check on verify is the
 * gate that keeps it out, and the token is discarded, never stored.
 */
export function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const codeInput = useRef<HTMLInputElement | null>(null);

  /**
   * Step 2 swaps the field IN PLACE while focus is parked on the submit
   * button, whose accessible name changes from «Sūtīt kodu» to «Pieslēgties»
   * underneath the user — nothing announces that a new input appeared.
   * Moving focus to it announces the field and saves a Tab.
   */
  useEffect(() => {
    if (step === 'code') codeInput.current?.focus();
  }, [step]);

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl()}/auth/otp/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone, role: 'rider' }),
      });
      if (!res.ok) {
        setError('console.request_failed');
        return;
      }
      setStep('code');
    } catch {
      setError('console.request_failed');
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl()}/auth/otp/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      });
      if (!res.ok) {
        setError('console.wrong_code');
        return;
      }
      const session = authSessionSchema.parse(await res.json());
      if (!hasConsoleRole(session)) {
        // Discard, never store: a rider/driver token in localStorage would
        // let the board hook hammer the API for 403s.
        setError('console.no_access');
        return;
      }
      saveSession(session);
      router.push('/dispatch');
    } catch {
      setError('console.wrong_code');
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    minHeight: 44,
    padding: 'var(--spacing-sm) var(--spacing-md)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-fg)',
    fontSize: 'var(--font-size-md)',
  };
  const buttonStyle: React.CSSProperties = {
    minHeight: 48,
    padding: 'var(--spacing-sm) var(--spacing-lg)',
    borderRadius: 'var(--radius-md)',
    border: 'none',
    background: 'var(--color-accent)',
    color: 'var(--color-accent-fg)',
    fontSize: 'var(--font-size-md)',
    fontWeight: 600,
    cursor: 'pointer',
  };

  return (
    <form
      onSubmit={step === 'phone' ? requestCode : verifyCode}
      style={{ display: 'grid', gap: 'var(--spacing-md)', maxWidth: 360 }}
    >
      {step === 'phone' ? (
        <label style={{ display: 'grid', gap: 'var(--spacing-xs)' }}>
          <span style={{ fontSize: 'var(--font-size-sm)' }}>
            {formatMessage(LANG, 'console.phone')}
          </span>
          <input
            type="tel"
            name="phone"
            autoComplete="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={formatMessage(LANG, 'console.phone_placeholder')}
            style={inputStyle}
          />
        </label>
      ) : (
        <label style={{ display: 'grid', gap: 'var(--spacing-xs)' }}>
          <span style={{ fontSize: 'var(--font-size-sm)' }}>
            {formatMessage(LANG, 'console.code')}
          </span>
          <input
            ref={codeInput}
            type="text"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            style={inputStyle}
          />
        </label>
      )}

      {error !== null && (
        <p
          role="alert"
          style={{
            margin: 0,
            color: 'var(--color-danger)',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          {formatMessage(LANG, error)}
        </p>
      )}

      <button type="submit" disabled={busy} style={buttonStyle}>
        {formatMessage(
          LANG,
          step === 'phone' ? 'console.send_code' : 'console.sign_in',
        )}
      </button>
    </form>
  );
}
