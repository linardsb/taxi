/**
 * `.claude/references/logging-standard.md`: never log full phone numbers —
 * mask to the last 3 digits. `+37126123456` -> `+371*****456`.
 */
export function maskPhone(phone: string): string {
  if (phone.length <= 3) return '*'.repeat(phone.length);
  const keep = phone.slice(-3);
  const head = phone.startsWith('+') ? phone.slice(0, 4) : '';
  const hidden = phone.length - head.length - keep.length;
  return `${head}${'*'.repeat(Math.max(0, hidden))}${keep}`;
}
