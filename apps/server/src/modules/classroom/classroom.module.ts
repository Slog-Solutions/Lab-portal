import { Module } from '@nestjs/common';
import { ControlModule } from '../control/control.module';
import { StationsModule } from '../stations/stations.module';
import { MediaModule } from '../media/media.module';
import { BatchesModule } from '../batches/batches.module';
import { TranslationModule } from '../translation/translation.module';
import { ClassAccessModule } from './class-access.module';
import { ClassroomService } from './classroom.service';
import { ClassroomController } from './classroom.controller';

@Module({
  imports: [ControlModule, StationsModule, MediaModule, ClassAccessModule, BatchesModule, TranslationModule],
  controllers: [ClassroomController],
  providers: [ClassroomService],
  exports: [ClassroomService],
})
export class ClassroomModule {}
