import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync } from 'node:fs';
import type { EnvConfig } from '../../config/env.validation';
import { StorageService } from '../../common/storage/storage.service';
import { ClassAccessModule } from '../classroom/class-access.module';
import { RecordingsService } from './recordings.service';
import { RecordingsController } from './recordings.controller';
import { ClassRecordingsService } from './class-recordings.service';
import { ClassRecordingsController } from './class-recordings.controller';

@Module({
  imports: [
    ClassAccessModule,
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService, StorageService],
      useFactory: (config: ConfigService<EnvConfig, true>, storage: StorageService) => ({
        limits: { fileSize: config.get('MAX_UPLOAD_MB', { infer: true }) * 1024 * 1024 },
        storage: diskStorage({
          // Was os.tmpdir() — cross-volume from LAB_DATA_ROOT once that
          // becomes D:\LabData in a real deployment, which makes
          // RecordingsService.finalizeUpload's fs.rename throw EXDEV. See
          // storage.service.ts's doc comment; same fix as the new
          // media-assets/content-packages upload paths.
          destination: (_req, _file, cb) => {
            const dir = storage.tempDir();
            mkdirSync(dir, { recursive: true });
            cb(null, dir);
          },
        }),
      }),
    }),
  ],
  controllers: [RecordingsController, ClassRecordingsController],
  providers: [RecordingsService, ClassRecordingsService],
  exports: [RecordingsService],
})
export class RecordingsModule {}
