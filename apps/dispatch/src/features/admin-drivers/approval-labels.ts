import type {
  DriverApprovalStatus,
  Language,
  MessageKey,
  RideCategory,
} from '@taxi/shared';

/**
 * Enum → catalog key maps. Each is a `Record` over the shared enum, so a new
 * approval status, category or language fails typecheck here until it has a
 * label — nothing falls through to a raw enum value on screen.
 */
export const APPROVAL_LABEL: Record<DriverApprovalStatus, MessageKey> = {
  pending: 'admin.approval.pending',
  approved: 'admin.approval.approved',
  rejected: 'admin.approval.rejected',
};

/** The verb that MOVES a driver to that status. */
export const APPROVAL_ACTION: Record<DriverApprovalStatus, MessageKey> = {
  pending: 'admin.action.reset',
  approved: 'admin.action.approve',
  rejected: 'admin.action.reject',
};

export const EMPTY_LIST: Record<DriverApprovalStatus, MessageKey> = {
  pending: 'admin.drivers.empty_pending',
  approved: 'admin.drivers.empty_approved',
  rejected: 'admin.drivers.empty_rejected',
};

export const CATEGORY_LABEL: Record<RideCategory, MessageKey> = {
  standard: 'admin.category.standard',
  fastest: 'admin.category.fastest',
  limo: 'admin.category.limo',
  vip: 'admin.category.vip',
};

/** The driver app's own language names — the same words the driver picked. */
export const LANGUAGE_LABEL: Record<Language, MessageKey> = {
  lv: 'driver.lang.lv',
  ru: 'driver.lang.ru',
  en: 'driver.lang.en',
};
