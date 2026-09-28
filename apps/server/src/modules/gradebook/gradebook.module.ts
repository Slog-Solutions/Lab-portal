import { Module } from '@nestjs/common';
import { BatchesModule } from '../batches/batches.module';
import { GradebookController } from './gradebook.controller';
import { GradebookService } from './gradebook.service';

@Module({
  // BatchAccessService (exported by BatchesModule) backs the class-roster
  // check when an assignment is created with a batchId — same authority
  // AssessmentsService uses.
  imports: [BatchesModule],
  controllers: [GradebookController],
  providers: [GradebookService],
  exports: [GradebookService],
})
export class GradebookModule {}
