import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StationsService } from './stations.service';
import { StationsController } from './stations.controller';

@Module({
  // StationsService.claim now reuses AuthService.authenticate/issueUserToken
  // (a student signing in at a seat, same credential check as a dashboard
  // login) — AuthModule exports AuthService and imports nothing from
  // StationsModule, so this doesn't create a cycle (see control.module.ts
  // for the same pattern).
  imports: [AuthModule],
  controllers: [StationsController],
  providers: [StationsService],
  exports: [StationsService],
})
export class StationsModule {}
