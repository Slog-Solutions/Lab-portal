import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Validates a controller argument against a @lab/shared zod schema.
 * Usage: @Body(new ZodValidationPipe(zLoginDto)) dto: LoginDto
 */
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      // Surface *why* — the generic "Validation failed" string used to be
      // all callers ever saw (api-client.ts reads body.message), leaving
      // e.g. a too-short batch join key indistinguishable from a missing
      // field. issues[] stays for any caller that wants the structured form.
      const message = result.error.issues
        .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
        .join('; ');
      throw new BadRequestException({
        message,
        issues: result.error.issues,
      });
    }
    return result.data;
  }
}
