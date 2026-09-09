import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync } from 'node:fs';
import type { EnvConfig } from '../../config/env.validation';
import { StorageService } from '../../common/storage/storage.service';
import { ContentPackagesController } from './content-packages.controller';
import { ContentPackagesService } from './content-packages.service';

@Module({
  imports: [
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService, StorageService],
      useFactory: (config: ConfigService<EnvConfig, true>, storage: StorageService) => ({
        limits: { fileSize: config.get('MAX_UPLOAD_MB', { infer: true }) * 1024 * 1024 },
        storage: diskStorage({
          destination: (_req, _file, cb) => {
            const dir = storage.tempDir();
            mkdirSync(dir, { recursive: true });
            cb(null, dir);
          },
        }),
      }),
    }),
  ],
  controllers: [ContentPackagesController],
  providers: [ContentPackagesService],
  exports: [ContentPackagesService],
})
export class ContentPackagesModule {}
