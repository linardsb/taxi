'use client';

import { formatMessage } from '@taxi/shared';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** `/admin` has no surface of its own: driver review is the landing page. */
export default function AdminPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/admin/drivers');
  }, [router]);

  return <p role="status">{formatMessage('lv', 'console.loading')}</p>;
}
