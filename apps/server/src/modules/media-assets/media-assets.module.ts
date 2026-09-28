import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync } from 'node:fs';
import type { EnvConfig } from '../../config/env.validation';
import { StorageService } from '../../common/storage/storage.service';
import { BatchesModule } from '../batches/batches.module';
import { MediaAssetsController } from './media-assets.controller';
import { MediaAssetsService } from './media-assets.service';

@Module({
  imports: [
    BatchesModule,
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService, StorageService],
      useFactory: (config: ConfigService<EnvConfig, true>, storage: StorageService) => ({
        limits: { fileSize: config.get('MAX_UPLOAD_MB', { infer: true }) * 1024 * 1024 },
        storage: diskStorage({
          // Temp files must land on the same volume as LAB_DATA_ROOT so
          // StorageService.commitFile's fs.rename is same-volume, not a
          // cross-drive EXDEV failure (see storage.service.ts's comment —
          // this is exactly the class of upload path that motivated it).
          destination: (_req, _file, cb) => {
            const dir = storage.tempDir();
            mkdirSync(dir, { recursive: true });
            cb(null, dir);
          },
        }),
      }),
    }),
  ],
  controllers: [MediaAssetsController],
  providers: [MediaAssetsService],
  exports: [MediaAssetsService],
})
export class MediaAssetsModule {}
