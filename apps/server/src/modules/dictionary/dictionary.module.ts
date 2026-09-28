import { Module } from '@nestjs/common';
import { DictionaryStoreService } from './dictionary-store.service';
import { DictionaryService } from './dictionary.service';
import { DictionaryPolicyService } from './dictionary-policy.service';
import { DictionaryAccessGuard } from './dictionary-access.guard';
import { DictionaryLogService } from './dictionary-log.service';
import { DictionaryExportService } from './dictionary-export.service';
import { DictionaryController } from './dictionary.controller';
import { DictionaryReportsController } from './dictionary-reports.controller';

@Module({
  controllers: [DictionaryController, DictionaryReportsController],
  providers: [
    DictionaryStoreService,
    DictionaryService,
    DictionaryPolicyService,
    DictionaryAccessGuard,
    DictionaryLogService,
    DictionaryExportService,
  ],
  exports: [DictionaryService],
})
export class DictionaryModule {}
