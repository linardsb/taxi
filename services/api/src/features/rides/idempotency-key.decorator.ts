import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { IDEMPOTENCY_KEY_HEADER } from '@taxi/shared';

/**
 * The raw `Idempotency-Key` header, for a `ZodValidationPipe` to validate.
 *
 * A custom decorator rather than `@Headers(IDEMPOTENCY_KEY_HEADER, pipe)`,
 * because `@Headers` is typed `(property?: string) => ParameterDecorator` and
 * takes NO pipes — the one built-in param decorator that doesn't. Anything built
 * with `createParamDecorator` does, so this recovers the per-parameter
 * validation every other bound parameter in the codebase uses.
 *
 * `unknown`, not `string`: a missing header is `undefined`, and the pipe is what
 * narrows it. Typing it `string` would hide that case from the compiler.
 */
export const IdempotencyKeyHeader = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): unknown =>
    ctx
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined> }>().headers[
      IDEMPOTENCY_KEY_HEADER
    ],
);
