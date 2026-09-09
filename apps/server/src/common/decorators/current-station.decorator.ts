import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/** Populated by StationAuthGuard/StationOrStaffGuard. */
export const CurrentStation = createParamDecorator((_data: unknown, ctx: ExecutionContext): { id: string } | undefined => {
  const request = ctx.switchToHttp().getRequest();
  return request.station;
});
