import { Module } from '@nestjs/common';
import { BatchesModule } from '../batches/batches.module';
import { GradebookModule } from '../gradebook/gradebook.module';
import { AssessmentsController } from './assessments.controller';
import { AssessmentsService } from './assessments.service';

@Module({
  imports: [GradebookModule, BatchesModule],
  controllers: [AssessmentsController],
  providers: [AssessmentsService],
})
export class AssessmentsModule {}
