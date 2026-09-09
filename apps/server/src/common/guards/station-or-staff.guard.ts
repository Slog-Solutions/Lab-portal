import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@lab/shared';
import type { JwtPayload } from '../../modules/auth/auth.service';

/**
 * For endpoints both a station and a teacher/admin legitimately read —
 * a recording's own station plays back its own audio for self-review
 * (Ser 2 model imitation, Ser 7 pronunciation), and a teacher/admin reads
 * the same recording from the gradebook. Write endpoints stay
 * station-only (StationAuthGuard) or role-only (@Roles); this guard is
 * deliberately read-path-only and does not scope "own" vs "any" recording
 * — that finer-grained check (a station could name another station's
 * recording id) is a follow-up, tracked the same way RecordingsController's
 * original @Public() gap was tracked rather than silently left unstated.
 */
@Injectable()
export class StationOrStaffGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtPayload | undefined;
    if (!user) throw new UnauthorizedException('Missing bearer token');

    if (user.kind === 'station') {
      request.station = { id: user.sub };
      return true;
    }
    if (user.role === UserRole.TEACHER || user.role === UserRole.ADMIN) {
      return true;
    }
    throw new ForbiddenException('Station or staff credential required');
  }
}
