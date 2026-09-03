import { phoneSchema } from '@taxi/shared';

/**
 * What a Latvian driver types → E.164, or nothing. `2xxxxxxx` (a local
 * mobile) and `371…` get the country code; a leading `+` is kept; spaces,
 * dashes and brackets are noise. Normalisation is the client's job (#7).
 */
export function normalisePhone(input: string): string | undefined {
  const compact = input.replace(/[\s\-()]/g, '');
  let candidate: string;
  if (compact.startsWith('+')) candidate = compact;
  else if (compact.startsWith('00')) candidate = `+${compact.slice(2)}`;
  else if (/^371\d{8}$/.test(compact)) candidate = `+${compact}`;
  else if (/^2\d{7}$/.test(compact)) candidate = `+371${compact}`;
  else candidate = compact;
  const parsed = phoneSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}
