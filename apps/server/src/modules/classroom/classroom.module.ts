import { Module } from '@nestjs/common';
import { ControlModule } from '../control/control.module';
import { StationsModule } from '../stations/stations.module';
import { MediaModule } from '../media/media.module';
import { BatchesModule } from '../batches/batches.module';
import { ClassAccessModule } from './class-access.module';
import { ClassroomService } from './classroom.service';
import { ClassroomController } from './classroom.controller';

@Module({
  imports: [ControlModule, StationsModule, MediaModule, ClassAccessModule, BatchesModule],
  controllers: [ClassroomController],
  providers: [ClassroomService],
  exports: [ClassroomService],
})
export class ClassroomModule {}
