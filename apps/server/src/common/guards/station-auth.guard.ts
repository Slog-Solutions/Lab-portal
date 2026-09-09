import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { JwtPayload } from '../../modules/auth/auth.service';

/**
 * Route-level authorization for station-only endpoints (recordings,
 * attempts) — Phase 3's fix for the documented "stations aren't
 * JWT-authenticated yet" gap. The global JwtAuthGuard has already run and
 * verified the bearer token (station or human — it doesn't discriminate);
 * this guard only asks "is the already-verified caller a station?" and
 * exposes the station id via `request.station` / @CurrentStation().
 *
 * Deliberately NOT a RolesGuard extension: `role: 'STATION'` is not a
 * UserRole member, so it can never accidentally satisfy a human-facing
 * @Roles(TEACHER, ADMIN) check, and this guard can never accidentally
 * admit a human token either.
 */
@Injectable()
export class StationAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtPayload | undefined;
    if (!user) {
      // The global JwtAuthGuard normally rejects a missing/invalid token
      // before this ever runs; this only fires if StationAuthGuard is
      // ever applied to a @Public() route by mistake.
      throw new UnauthorizedException('Missing bearer token');
    }
    if (user.kind !== 'station') {
      throw new ForbiddenException('Station credential required');
    }
    request.station = { id: user.sub };
    return true;
  }
}
