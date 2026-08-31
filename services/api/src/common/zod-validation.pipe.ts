import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ApiErrorBody } from '@taxi/shared';
import type { ZodType } from 'zod';

/**
 * Used per-parameter (`@Body(new ZodValidationPipe(schema))`), never globally —
 * a global zod pipe has no schema to apply. Issues are mapped rather than
 * passed through, so no zod internals leak into the HTTP response.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const body: ApiErrorBody = {
        message: 'validation_failed',
        issues: result.error.issues.map((i) => ({
          path: i.path,
          message: i.message,
        })),
      };
      throw new BadRequestException(body);
    }
    return result.data;
  }
}
