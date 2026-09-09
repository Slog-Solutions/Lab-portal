import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Phase 5 hardening. Registered globally (APP_GUARD in AuthModule) like
 * JwtAuthGuard/RolesGuard, which means it also runs in front of every
 * ControlGateway @SubscribeMessage handler — the built-in ThrottlerGuard
 * calls `context.switchToHttp().getRequest()` unconditionally, which
 * throws on a WS execution context. This is the exact bug class Phase 0's
 * close-out already documents for JwtAuthGuard/RolesGuard (it silently
 * broke `station:hello` for every station the first time); the fix is the
 * same one-line short-circuit, applied here before it could ship broken
 * rather than after a station outage found it.
 */
@Injectable()
export class HttpThrottlerGuard extends ThrottlerGuard {
  override canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return Promise.resolve(true);
    return super.canActivate(context);
  }
}
