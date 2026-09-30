import { Module } from '@nestjs/common';
import { StationsModule } from '../stations/stations.module';
import { EnglishCourseController, EnglishCourseStaffController } from './english-course.controller';
import { EnglishCourseService } from './english-course.service';

@Module({
  imports: [StationsModule],
  controllers: [EnglishCourseStaffController, EnglishCourseController],
  providers: [EnglishCourseService],
  exports: [EnglishCourseService],
})
export class EnglishCourseModule {}
