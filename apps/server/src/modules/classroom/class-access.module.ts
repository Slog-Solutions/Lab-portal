import { Module } from '@nestjs/common';
import { ClassAccessService } from './class-access.service';

// Deliberately imports nothing else (see ClassAccessService's doc comment)
// so ControlModule, MediaModule, SessionsModule and ClassroomModule can
// all import this without creating a cycle.
@Module({
  providers: [ClassAccessService],
  exports: [ClassAccessService],
})
export class ClassAccessModule {}
