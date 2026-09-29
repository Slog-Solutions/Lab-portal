import { Module } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { SessionsController } from './sessions.controller';
import { MediaModule } from '../media/media.module';
import { ControlModule } from '../control/control.module';
import { BatchesModule } from '../batches/batches.module';
import { ClassAccessModule } from '../classroom/class-access.module';
import { RoundTableModule } from '../round-table/round-table.module';
import { TestClockModule } from '../timed-tests/test-clock.module';

@Module({
  imports: [MediaModule, ControlModule, BatchesModule, ClassAccessModule, RoundTableModule, TestClockModule],
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
