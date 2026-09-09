import { Module } from '@nestjs/common';
import { StudyModulesController } from './study-modules.controller';
import { StudyModulesService } from './study-modules.service';

@Module({
  controllers: [StudyModulesController],
  providers: [StudyModulesService],
  exports: [StudyModulesService],
})
export class StudyModulesModule {}
