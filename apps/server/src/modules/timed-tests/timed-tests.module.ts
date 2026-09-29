import { Module } from '@nestjs/common';
import { TestClockModule } from './test-clock.module';
import { TestCloseService } from './test-close.service';
import { TimedTestsService } from './timed-tests.service';
import { TimedTestsController } from './timed-tests.controller';
import { SessionsModule } from '../sessions/sessions.module';
import { AttemptsModule } from '../attempts/attempts.module';
import { ControlModule } from '../control/control.module';
import { BatchesModule } from '../batches/batches.module';

/** SPEC-mcq-test-timed-reveal.md's cohort engine: the 5s close scheduler
 * (TestCloseService) plus "Launch in lab" and the teacher's live overrides
 * (TimedTestsService). Imports SessionsModule directly (not just
 * TestClockModule) because launch() drives SessionsService.create/arm/start
 * and the close sequence republishes through SessionsService.republish —
 * no cycle results because SessionsModule itself only imports
 * TestClockModule, never this module. */
@Module({
  imports: [TestClockModule, SessionsModule, AttemptsModule, ControlModule, BatchesModule],
  controllers: [TimedTestsController],
  providers: [TestCloseService, TimedTestsService],
  exports: [TestCloseService, TimedTestsService],
})
export class TimedTestsModule {}
