import { formatMessage } from '@taxi/shared';
import { Suspense } from 'react';
import { DriversScreen } from '@/features/admin-drivers';

/**
 * A server component on purpose: `DriversScreen` reads `useSearchParams`, and
 * Next 16 fails `build` (`missing-suspense-with-csr-bailout`) unless a static
 * page wraps that in a Suspense boundary. Dev does not catch it; build does.
 */
export default function AdminDriversPage() {
  return (
    <Suspense
      fallback={<p role="status">{formatMessage('lv', 'console.loading')}</p>}
    >
      <DriversScreen />
    </Suspense>
  );
}
