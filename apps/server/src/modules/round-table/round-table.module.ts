import { Module } from '@nestjs/common';
import { RoundTableService } from './round-table.service';
import { RoundTableGateway } from './round-table.gateway';
import { RoundTableController } from './round-table.controller';
import { ControlModule } from '../control/control.module';
import { MediaModule } from '../media/media.module';
import { BatchesModule } from '../batches/batches.module';

@Module({
  imports: [ControlModule, MediaModule, BatchesModule],
  controllers: [RoundTableController],
  providers: [RoundTableService, RoundTableGateway],
  exports: [RoundTableService],
})
export class RoundTableModule {}
