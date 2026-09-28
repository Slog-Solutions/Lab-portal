import { Module } from '@nestjs/common';
import { BatchesModule } from '../batches/batches.module';
import { GradebookModule } from '../gradebook/gradebook.module';
import { MediaAssetsModule } from '../media-assets/media-assets.module';
import { PronunciationController } from './pronunciation.controller';
import { PronunciationService } from './pronunciation.service';
import { PronunciationTestsController } from './pronunciation-tests.controller';
import { PronunciationTestsService } from './pronunciation-tests.service';

@Module({
  // BatchesModule for BatchAccessService — the class-roster check when a
  // one-step exercise is sent to a class (PronunciationService.createExercise).
  imports: [MediaAssetsModule, GradebookModule, BatchesModule],
  controllers: [PronunciationController, PronunciationTestsController],
  providers: [PronunciationService, PronunciationTestsService],
})
export class PronunciationModule {}
