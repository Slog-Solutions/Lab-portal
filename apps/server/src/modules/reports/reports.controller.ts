import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { UserRole } from '@lab/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { ReportsService } from './reports.service';

@Roles(UserRole.TEACHER, UserRole.ADMIN)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('attempts.xlsx')
  async attemptsXlsx(
    @Res() res: Response,
    @Query('studentId') studentId?: string,
    @Query('exerciseId') exerciseId?: string,
    @Query('status') status?: string,
  ): Promise<void> {
    await this.reports.streamXlsx({ studentId, exerciseId, status }, res);
  }

  @Get('attempts.pdf')
  async attemptsPdf(
    @Res() res: Response,
    @Query('studentId') studentId?: string,
    @Query('exerciseId') exerciseId?: string,
    @Query('status') status?: string,
  ): Promise<void> {
    await this.reports.streamPdf({ studentId, exerciseId, status }, res);
  }
}
