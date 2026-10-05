/**
 * The admin shell's public API (#20): the nav every `/admin` page sits under,
 * and the fetch every admin slice makes.
 */
export {
  AdminApiError,
  AdminAuthExpiredError,
  adminErrorKey,
  adminFetch,
  adminFetchBlob,
} from './admin-api';
export { AdminNav } from './admin-nav';
