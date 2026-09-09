import { Module } from '@nestjs/common';
import { MediaAssetsModule } from '../media-assets/media-assets.module';
import { PronunciationController } from './pronunciation.controller';
import { PronunciationService } from './pronunciation.service';

@Module({
  imports: [MediaAssetsModule],
  controllers: [PronunciationController],
  providers: [PronunciationService],
})
export class PronunciationModule {}
