'use client';

import {
  adminDriverDetailSchema,
  adminDriverSummarySchema,
  vehicleSchema,
  type AdminDriverDetail,
  type AdminDriverSummary,
  type AdminDriverUpdate,
  type AdminVehicleUpdate,
  type DriverApprovalStatus,
  type Vehicle,
} from '@taxi/shared';
import { z } from 'zod';
import { AdminApiError, adminFetch } from '@/features/admin-shell';

/** The six `/admin/drivers` + `/admin/vehicles` calls (#20), each parsed. */

export function listDrivers(
  approval: DriverApprovalStatus,
): Promise<AdminDriverSummary[]> {
  const params = new URLSearchParams({ approval });
  return adminFetch(
    `/admin/drivers?${params.toString()}`,
    z.array(adminDriverSummarySchema),
  );
}

export function getDriver(id: string): Promise<AdminDriverDetail> {
  // The id comes from the URL. One that is not a uuid names no driver: sent,
  // the api's pipe answers 400 `validation_failed`, which would read as a
  // generic error beside a Retry that can never work.
  if (!z.string().uuid().safeParse(id).success) {
    return Promise.reject(new AdminApiError('driver_not_found'));
  }
  return adminFetch(
    `/admin/drivers/${encodeURIComponent(id)}`,
    adminDriverDetailSchema,
  );
}

export function updateDriver(
  id: string,
  patch: AdminDriverUpdate,
): Promise<AdminDriverDetail> {
  return adminFetch(
    `/admin/drivers/${encodeURIComponent(id)}`,
    adminDriverDetailSchema,
    { method: 'PATCH', body: JSON.stringify(patch) },
  );
}

export function setApproval(
  id: string,
  status: DriverApprovalStatus,
): Promise<AdminDriverDetail> {
  return adminFetch(
    `/admin/drivers/${encodeURIComponent(id)}/approval`,
    adminDriverDetailSchema,
    { method: 'PUT', body: JSON.stringify({ status }) },
  );
}

export function updateVehicle(
  id: string,
  patch: AdminVehicleUpdate,
): Promise<Vehicle> {
  return adminFetch(`/admin/vehicles/${encodeURIComponent(id)}`, vehicleSchema, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteVehicle(id: string): Promise<null> {
  return adminFetch(`/admin/vehicles/${encodeURIComponent(id)}`, z.null(), {
    method: 'DELETE',
  });
}
