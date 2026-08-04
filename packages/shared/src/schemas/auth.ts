import { z } from "zod";
import { USER_ROLES } from "../enums";
import { phoneSchema, userSchema } from "./user";

/**
 * The roles a phone number may claim for itself. `dispatcher` and `admin`
 * accounts are provisioned (#20) — they still sign in by OTP, but only
 * because their user row already exists.
 */
export const SIGNUP_ROLES = ["rider", "driver"] as const;
export type SignupRole = (typeof SIGNUP_ROLES)[number];

export const otpRequestSchema = z.object({
  phone: phoneSchema,
  /** Used ONLY when the phone has no user yet; an existing user's stored role wins. */
  role: z.enum(SIGNUP_ROLES),
});
export type OtpRequest = z.infer<typeof otpRequestSchema>;

/** Identical for known and unknown numbers — no enumeration oracle. */
export const otpRequestResponseSchema = z.object({
  expiresInSeconds: z.number().int().positive(),
  resendAfterSeconds: z.number().int().nonnegative(),
});
export type OtpRequestResponse = z.infer<typeof otpRequestResponseSchema>;

export const otpCodeSchema = z.string().regex(/^\d{6}$/, "expected a 6-digit code");

export const otpVerifySchema = z.object({ phone: phoneSchema, code: otpCodeSchema });
export type OtpVerify = z.infer<typeof otpVerifySchema>;

/**
 * WIRE shape. `userSchema.createdAt` is `z.coerce.date()` (the DOMAIN shape);
 * JSON carries an ISO string, so it is overridden here for the same reason
 * `rideOfferEventSchema` overrides its two timestamps — see realtime-events.ts.
 */
export const authSessionSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.string().datetime(),
  user: userSchema.extend({ createdAt: z.string().datetime() }),
});
export type AuthSession = z.infer<typeof authSessionSchema>;

/**
 * What the api signs and what every guard/handshake parses back out.
 *
 * Deliberately carries no `phone`: a JWT is base64, not encryption, and the
 * logging standard forbids unmasked phone numbers in artifacts.
 */
export const jwtClaimsSchema = z.object({
  sub: z.string().uuid(),
  role: z.enum(USER_ROLES),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type JwtClaims = z.infer<typeof jwtClaimsSchema>;
