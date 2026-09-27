import { z } from 'zod';
import { LANGUAGES, USER_ROLES } from '../enums';

/** E.164, Latvian mobiles are +371 2xxxxxxx but foreign riders exist. */
export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, 'expected E.164 phone number');

/** `users.display_name`'s contract bound, shared by every reader and writer (#269). */
export const DISPLAY_NAME_MAX = 120;

export const userSchema = z.object({
  id: z.string().uuid(),
  phone: phoneSchema,
  email: z.string().email().optional(),
  role: z.enum(USER_ROLES),
  language: z.enum(LANGUAGES).default('lv'),
  displayName: z.string().min(1).max(DISPLAY_NAME_MAX).optional(),
  createdAt: z.coerce.date(),
});
export type User = z.infer<typeof userSchema>;

/**
 * A name as WRITTEN — by the rider (`PUT /riders/me/display-name`) or by Dina
 * (`callerName`, normalised through this). Trimmed first, so «  Anna » stores
 * «Anna» and «   » is not a name. Control characters are refused: the name is
 * rendered on the driver's screen and spoken at the kerb (#259).
 */
export const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(DISPLAY_NAME_MAX)
  .regex(/^\P{Cc}+$/u, 'control characters are not allowed');

/**
 * A name as READ from `users.display_name`, which is unconstrained `text`:
 * blank → null, over-long → cut. Every read that feeds a 1–120 contract goes
 * through this, so one bad row cannot fail a whole response (#261's reason).
 */
export function readDisplayName(raw: string | null | undefined): string | null {
  // `|| null`, not `?? null`: '' must become null.
  return raw?.trim().slice(0, DISPLAY_NAME_MAX) || null;
}

/** `PUT /riders/me/display-name`. `null` removes the name. */
export const riderDisplayNameUpdateSchema = z.object({
  displayName: displayNameSchema.nullable(),
});
export type RiderDisplayNameUpdate = z.infer<
  typeof riderDisplayNameUpdateSchema
>;
