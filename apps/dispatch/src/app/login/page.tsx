import { formatMessage } from '@taxi/shared';
import type { Metadata } from 'next';
import { LoginForm } from '@/features/auth';

export const metadata: Metadata = {
  title: formatMessage('lv', 'console.login_title'),
};

export default function LoginPage() {
  return (
    <main
      className="console"
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--spacing-lg)',
        padding: 'var(--spacing-lg)',
        background: 'var(--color-bg)',
        color: 'var(--color-fg)',
      }}
    >
      <h1 style={{ margin: 0, fontSize: 'var(--font-size-xl)' }}>
        {formatMessage('lv', 'console.login_title')}
      </h1>
      <LoginForm />
    </main>
  );
}
