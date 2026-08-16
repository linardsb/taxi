/**
 * The auth slice's public API — session persistence, the login form, the
 * client role gate, and the API origin every console fetch/socket dials.
 */
export { apiUrl } from './api-url';
export { LoginForm } from './login-form';
export { RequireRole } from './require-role';
export {
  BOARD_SNAPSHOT_STORAGE_KEY,
  CONSOLE_ROLES,
  clearSession,
  hasConsoleRole,
  loadSession,
  saveSession,
} from './session';
export { useSession } from './use-session';
