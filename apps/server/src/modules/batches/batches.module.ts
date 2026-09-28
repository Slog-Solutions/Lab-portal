import { Module } from '@nestjs/common';
import { BatchAccessService } from './batch-access.service';
import { BatchesService } from './batches.service';
import { BatchesController } from './batches.controller';
import { ClassHistoryService } from './class-history.service';

@Module({
  controllers: [BatchesController],
  providers: [BatchAccessService, BatchesService, ClassHistoryService],
  // Both exported: SessionsModule uses BatchAccessService for enforcement
  // (assertCanUseBatch) and BatchesService for the GET /sessions/batches
  // delegate (listForPrincipal) — one authority for "who may use which
  // batch", not reimplemented in SessionsService.
  exports: [BatchAccessService, BatchesService],
})
export class BatchesModule {}
