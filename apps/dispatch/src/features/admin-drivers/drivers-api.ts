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
import { adminFetch } from '@/features/admin-shell';

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
