import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './common/storage/storage.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { StationsModule } from './modules/stations/stations.module';
import { ControlModule } from './modules/control/control.module';
import { MediaModule } from './modules/media/media.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { RecordingsModule } from './modules/recordings/recordings.module';
import { MediaAssetsModule } from './modules/media-assets/media-assets.module';
import { ContentPackagesModule } from './modules/content/content-packages.module';
import { ExercisesModule } from './modules/exercises/exercises.module';
import { AttemptsModule } from './modules/attempts/attempts.module';
import { GradebookModule } from './modules/gradebook/gradebook.module';
import { ReportsModule } from './modules/reports/reports.module';
import { PronunciationModule } from './modules/pronunciation/pronunciation.module';
import { StudyModulesModule } from './modules/study-modules/study-modules.module';
import { AdminModule } from './modules/admin/admin.module';
import { BatchesModule } from './modules/batches/batches.module';
import { ClassroomModule } from './modules/classroom/classroom.module';

/**
 * Phase 0-5 wiring.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    StorageModule,
    AuditModule,
    AuthModule,
    UsersModule,
    StationsModule,
    MediaModule,
    ControlModule,
    BatchesModule,
    ClassroomModule,
    SessionsModule,
    RecordingsModule,
    MediaAssetsModule,
    ContentPackagesModule,
    ExercisesModule,
    AttemptsModule,
    GradebookModule,
    ReportsModule,
    PronunciationModule,
    StudyModulesModule,
    AdminModule,
  ],
})
export class AppModule {}
