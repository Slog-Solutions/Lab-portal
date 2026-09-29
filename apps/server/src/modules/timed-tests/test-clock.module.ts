import { Module } from '@nestjs/common';
import { TestClockService } from './test-clock.service';

/** Split out of TimedTestsModule so SessionsModule can depend on just the
 * clock (see TestClockService's own doc comment on why). */
@Module({
  providers: [TestClockService],
  exports: [TestClockService],
})
export class TestClockModule {}
