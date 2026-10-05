'use client';

import { formatMessage, type Language, type MessageKey } from '@taxi/shared';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { clearSession } from '@/features/auth';

const LANG: Language = 'lv';

/** One entry per admin surface; #20's config and trips PRs append theirs. */
const LINKS: readonly { href: string; label: MessageKey }[] = [
  { href: '/admin/drivers', label: 'admin.nav.drivers' },
];

const itemStyle: React.CSSProperties = {
  minHeight: 44,
  display: 'inline-flex',
  alignItems: 'center',
  padding: 'var(--spacing-xs) var(--spacing-md)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--font-size-md)',
  color: 'var(--color-fg)',
};

/** The admin panel's top bar: its surfaces plus logout. */
export function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav
      aria-label={formatMessage(LANG, 'admin.nav.label')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--spacing-sm)',
        paddingBottom: 'var(--spacing-md)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      {LINKS.map(({ href, label }) => {
        const current = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? 'page' : undefined}
            style={{
              ...itemStyle,
              textDecoration: 'none',
              fontWeight: current ? 700 : 400,
              background: current ? 'var(--color-bg-surface)' : 'transparent',
            }}
          >
            {formatMessage(LANG, label)}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={() => {
          clearSession();
          router.replace('/login');
        }}
        style={{
          ...itemStyle,
          marginLeft: 'auto',
          border: '1px solid var(--color-border)',
          background: 'transparent',
          cursor: 'pointer',
        }}
      >
        {formatMessage(LANG, 'admin.nav.logout')}
      </button>
    </nav>
  );
}
