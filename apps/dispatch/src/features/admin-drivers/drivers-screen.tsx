'use client';

import { DRIVER_APPROVAL_STATUSES } from '@taxi/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { DriverDetail } from './driver-detail';
import { DriverList } from './driver-list';

const filterSchema = z.enum(DRIVER_APPROVAL_STATUSES).catch('pending');

/**
 * `/admin/drivers` — the list, or one driver when `?id=` is set. Both the
 * driver and the list filter live in the URL, so both the page's Back link and
 * the browser's return to the queue the admin came from. `useSearchParams` makes the page's server
 * component wrap this in `<Suspense>` (Next 16 fails the build without it).
 */
export function DriversScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get('id');
  const filter = filterSchema.parse(params.get('approval'));

  if (id !== null) {
    return (
      <DriverDetail key={id} id={id} backHref={`/admin/drivers?approval=${filter}`} />
    );
  }
  return (
    <DriverList
      filter={filter}
      onFilterChange={(next) => router.replace(`/admin/drivers?approval=${next}`)}
    />
  );
}
