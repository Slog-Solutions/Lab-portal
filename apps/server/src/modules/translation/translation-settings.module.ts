import { Module } from '@nestjs/common';
import { TranslationSettingsService } from './translation-settings.service';

/**
 * Split out of TranslationModule so ControlModule can read translation
 * settings (SessionStateService needs the enabled-language list for every
 * station snapshot) without importing the module that holds the
 * reconciler — which itself depends on ControlModule. Same
 * cycle-avoidance as TranslationStateStore living in ControlModule.
 *
 * Only depends on the (global) PrismaModule, so it is safe to import
 * from anywhere.
 */
@Module({
  providers: [TranslationSettingsService],
  exports: [TranslationSettingsService],
})
export class TranslationSettingsModule {}
