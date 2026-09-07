import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@lab/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { JwtPayload } from '../../modules/auth/auth.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Same reasoning as JwtAuthGuard: this runs in front of ControlGateway
    // handlers too as a global guard. No @Roles() is applied to any
    // gateway method today, so requiredRoles would already be undefined
    // and short-circuit below — but guard explicitly against
    // switchToHttp().getRequest() on a ws context so a future @Roles()
    // on a gateway handler fails loudly and obviously rather than by
    // throwing from inside this guard.
    if (context.getType() !== 'http') return true;

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtPayload | undefined;
    if (!user || !requiredRoles.includes(user.role as UserRole)) {
      throw new ForbiddenException('Insufficient role for this action');
    }
    return true;
  }
}
