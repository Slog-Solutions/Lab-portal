import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload } from '../../modules/auth/auth.service';

export const IS_PUBLIC_KEY = 'isPublic';
// MUST use Nest's SetMetadata, not raw Reflect.metadata(): SetMetadata
// writes to descriptor.value (the handler function itself), which is
// exactly what context.getHandler() returns. Plain Reflect.metadata()
// writes to (prototype, propertyKey) instead, which Reflector.get()
// never looks up — the guard would silently never see it as public.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // This guard is registered globally (APP_GUARD in AuthModule), so it
    // also runs in front of every ControlGateway @SubscribeMessage
    // handler — NOT just HTTP routes. Those are deliberately NOT
    // Bearer-JWT-authenticated (design doc §4.2, §3.6): dashboards
    // authenticate at socket connect time via handshake.auth.token
    // (ControlGateway.handleConnection), and stations identify
    // themselves via station:hello. Calling switchToHttp().getRequest()
    // on a ws execution context throws, so this guard must get out of
    // the way entirely for non-HTTP contexts rather than try to enforce
    // an HTTP-shaped check on them.
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const token = extractBearerToken(request.headers?.authorization);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}

export function extractBearerToken(authorizationHeader?: string): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}
