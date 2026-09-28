import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ControlGateway } from './control.gateway';
import { ControlController } from './control.controller';
import { PresenceService } from './presence.service';
import { SessionStateService } from './session-state.service';
import { LockService } from './lock.service';
import { RemoteControlSessionService } from './remote-control-session.service';
import { ScreenShareService } from './screen-share.service';
import { CommandsService } from './commands.service';
import { RoundTableFloorStore } from './round-table-floor.store';
import { StationsModule } from '../stations/stations.module';
import { MediaModule } from '../media/media.module';
import { AuthModule } from '../auth/auth.module';
import { ClassAccessModule } from '../classroom/class-access.module';

@Module({
  imports: [
    StationsModule,
    MediaModule,
    AuthModule,
    ClassAccessModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: '8h' },
      }),
    }),
  ],
  controllers: [ControlController],
  providers: [
    ControlGateway,
    PresenceService,
    SessionStateService,
    LockService,
    RemoteControlSessionService,
    ScreenShareService,
    CommandsService,
    RoundTableFloorStore,
  ],
  exports: [
    PresenceService,
    SessionStateService,
    LockService,
    RemoteControlSessionService,
    ScreenShareService,
    CommandsService,
    ControlGateway,
    RoundTableFloorStore,
  ],
})
export class ControlModule {}
