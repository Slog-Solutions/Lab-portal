import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/** @Global() — every Phase 3 module (media assets, content packages,
 * recordings) needs the same LabData root convention. */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
