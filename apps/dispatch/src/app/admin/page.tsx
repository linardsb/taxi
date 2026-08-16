'use client';

import { formatMessage } from '@taxi/shared';

/** Placeholder — the admin surfaces (stats, config, onboarding) are #20. */
export default function AdminPage() {
  return (
    <main
      className="console"
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--spacing-lg)',
        background: 'var(--color-bg)',
        color: 'var(--color-fg)',
      }}
    >
      <p style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>
        {formatMessage('lv', 'console.admin_placeholder')}
      </p>
    </main>
  );
}
