import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { HttpThrottlerGuard } from '../../common/guards/http-throttler.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '8h' },
      }),
    }),
    // Phase 5 hardening: a generous global default (legitimate polling —
    // status-board/session list refetch every 10s, several dashboards at
    // once — must never trip this) with @Throttle() overrides tightening
    // the two genuinely brute-forceable @Public() routes: login
    // (password guessing) and station claim (service-number enumeration —
    // see StationsService.claim's own doc comment on why that route takes
    // no password at all, which is exactly what makes rate-limiting it
    // matter more, not less).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Global guards: every route requires a valid JWT unless annotated
    // @Public(), and @Roles(...) restricts by role on top of that.
    // ThrottlerGuard runs regardless of auth outcome — brute-force
    // protection has to apply to requests that never carry a valid
    // credential in the first place.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: HttpThrottlerGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
