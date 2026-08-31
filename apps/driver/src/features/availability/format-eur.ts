/**
 * Integer cents → `€84.20` / `-€1.86`. Integer arithmetic only (root rule:
 * never floats). The format — symbol first, dot decimal — is a placeholder
 * pending the brand copy pass (logged in ui-decisions.md).
 */
export function formatEur(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  const euros = Math.trunc(abs / 100);
  const rest = abs % 100;
  return `${sign}€${euros}.${String(rest).padStart(2, '0')}`;
}
