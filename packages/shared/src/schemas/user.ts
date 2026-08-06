import { z } from 'zod';
import { LANGUAGES, USER_ROLES } from '../enums';

/** E.164, Latvian mobiles are +371 2xxxxxxx but foreign riders exist. */
export const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, 'expected E.164 phone number');

export const userSchema = z.object({
  id: z.string().uuid(),
  phone: phoneSchema,
  email: z.string().email().optional(),
  role: z.enum(USER_ROLES),
  language: z.enum(LANGUAGES).default('lv'),
  displayName: z.string().min(1).max(120).optional(),
  createdAt: z.coerce.date(),
});
export type User = z.infer<typeof userSchema>;
