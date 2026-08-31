import { z } from 'zod';

/**
 * The api's error envelope — what every non-2xx body looks like and what the
 * apps parse it with. `message` is the snake_case code (`vehicle_required`,
 * `validation_failed`, Nest's own `Unauthorized`); `retryAfterSeconds` rides
 * on a 429 (`resend_too_soon`); `issues` on a 400 from `ZodValidationPipe`,
 * mapped from zod's own so no zod internals cross the wire. The api types its
 * producers with `ApiErrorBody`; the driver app `safeParse`s with the schema
 * and reads anything else as `generic`.
 */
export const apiIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
});
export type ApiIssue = z.infer<typeof apiIssueSchema>;

export const apiErrorBodySchema = z.object({
  message: z.string(),
  retryAfterSeconds: z.number().int().nonnegative().optional(),
  issues: z.array(apiIssueSchema).optional(),
});
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;
