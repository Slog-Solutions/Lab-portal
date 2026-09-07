import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { StationsModule } from './modules/stations/stations.module';
import { ControlModule } from './modules/control/control.module';
import { MediaModule } from './modules/media/media.module';
import { SessionsModule } from './modules/sessions/sessions.module';

/**
 * Phase 0 wiring. Sessions/Groups/Activities/Media/Exercises/Attempts/
 * Gradebook/Recordings/Reports/Admin modules attach here in Phases 1-5
 * per the build plan — their directories already exist under
 * src/modules/ so each phase is additive, never a restructure.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    StationsModule,
    MediaModule,
    ControlModule,
    SessionsModule,
  ],
})
export class AppModule {}
