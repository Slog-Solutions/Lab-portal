import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@lab/shared';
import type { JwtPayload } from '../auth/auth.service';
import { DictionaryPolicyService } from './dictionary-policy.service';

/**
 * Runs the spec §7 server-side enforcement in front of lookup/suggest/
 * search (not meta — a disabled dictionary should still be able to show
 * the About screen). Same station-vs-staff split as StationOrStaffGuard,
 * but additionally consults DictionaryPolicyService rather than merely
 * admitting every station unconditionally — this is the one guard in the
 * app whose whole job IS to sometimes say no to a validly-authenticated
 * station.
 */
@Injectable()
export class DictionaryAccessGuard implements CanActivate {
  constructor(private readonly policy: DictionaryPolicyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtPayload | undefined;
    if (!user) throw new UnauthorizedException('Missing bearer token');

    if (user.kind === 'station') {
      await this.policy.assertAllowed({ kind: 'station', stationId: user.sub });
      return true;
    }
    if (user.role === UserRole.TEACHER || user.role === UserRole.ADMIN) {
      await this.policy.assertAllowed({ kind: 'staff' });
      return true;
    }
    // A student's own JWT carries no station context to check an
    // activity against — the desktop app calls these routes with the
    // station's own token (see stationApi), so this path is not expected
    // in normal use; refusing it is the safe default, matching
    // StationAuthGuard's own posture for a similarly out-of-shape token.
    throw new ForbiddenException('Station or staff credential required');
  }
}
