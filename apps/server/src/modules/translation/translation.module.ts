import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync } from 'node:fs';
import type { EnvConfig } from '../../config/env.validation';
import { StorageService } from '../../common/storage/storage.service';
import { ControlModule } from '../control/control.module';
import { MediaModule } from '../media/media.module';
import { AuditModule } from '../audit/audit.module';
import { TranslationController } from './translation.controller';
import { TranslationGateway } from './translation.gateway';
import { TranslationService } from './translation.service';
import { TranslationSettingsModule } from './translation-settings.module';
import { TranslationTestsService } from './translation-tests.service';
import { TranslatorClient } from './translator.client';

/**
 * Live class translation (SeamlessStreaming) plus the Translation Lab.
 *
 * Imports ControlModule (for ControlGateway/SessionStateService/
 * TranslationStateStore) and is itself imported by ClassroomModule for
 * the class start/end hooks — so the dependency runs
 * Classroom -> Translation -> Control, never back. The two pieces
 * ControlModule needs in the other direction (TranslationStateStore,
 * TranslationSettingsService) deliberately live outside this module for
 * that reason.
 */
@Module({
  imports: [
    ControlModule,
    MediaModule,
    AuditModule,
    TranslationSettingsModule,
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService, StorageService],
      useFactory: (config: ConfigService<EnvConfig, true>, storage: StorageService) => ({
        limits: { fileSize: config.get('MAX_UPLOAD_MB', { infer: true }) * 1024 * 1024 },
        storage: diskStorage({
          // Same volume as LAB_DATA_ROOT so the move into the run's own
          // directory is a rename, not a cross-device copy — see
          // StorageService's doc comment.
          destination: (_req, _file, cb) => {
            const dir = storage.tempDir();
            mkdirSync(dir, { recursive: true });
            cb(null, dir);
          },
        }),
      }),
    }),
  ],
  controllers: [TranslationController],
  providers: [TranslatorClient, TranslationService, TranslationTestsService, TranslationGateway],
  exports: [TranslationService, TranslatorClient],
})
export class TranslationModule {}
