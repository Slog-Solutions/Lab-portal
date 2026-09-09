import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole, zAssignmentDto, zScoreOverrideDto, type AssignmentDto, type ScoreOverrideDto } from '@lab/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { JwtPayload } from '../auth/auth.service';
import { GradebookService } from './gradebook.service';

@Roles(UserRole.TEACHER, UserRole.ADMIN)
@Controller('gradebook')
export class GradebookController {
  constructor(private readonly gradebook: GradebookService) {}

  @Post('assignments')
  async createAssignments(
    @Body(new ZodValidationPipe(zAssignmentDto)) dto: AssignmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.gradebook.createAssignments(user.sub, dto);
  }

  @Get('assignments')
  async listAssignments(@Query('studentId') studentId?: string, @Query('exerciseId') exerciseId?: string) {
    return this.gradebook.listAssignments({ studentId, exerciseId });
  }

  @Get('attempts')
  async listAttempts(
    @Query('studentId') studentId?: string,
    @Query('exerciseId') exerciseId?: string,
    @Query('status') status?: string,
  ) {
    return this.gradebook.listAttempts({ studentId, exerciseId, status });
  }

  @Get('attempts/:id')
  async getAttempt(@Param('id') id: string) {
    return this.gradebook.getAttempt(id);
  }

  @Post('attempts/:id/override')
  async override(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zScoreOverrideDto)) dto: ScoreOverrideDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.gradebook.override(user.sub, { ...dto, attemptId: id });
  }
}
