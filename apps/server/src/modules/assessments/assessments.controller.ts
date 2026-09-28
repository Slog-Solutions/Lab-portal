import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ActivityType,
  UserRole,
  zCreateAssessmentDto,
  zGradeAssessmentDto,
  type CreateAssessmentDto,
  type GradeAssessmentDto,
} from '@lab/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { JwtPayload } from '../auth/auth.service';
import { AssessmentsService, ASSESSMENT_TYPES } from './assessments.service';

/** The "Create Assignment" pages — see the service's doc comment. Adding
 * more students to an existing assignment later reuses POST
 * /gradebook/assignments, so there is no endpoint for it here. */
@Roles(UserRole.TEACHER, UserRole.ADMIN)
@Controller('assessments')
export class AssessmentsController {
  constructor(private readonly assessments: AssessmentsService) {}

  @Post()
  create(@Body(new ZodValidationPipe(zCreateAssessmentDto)) dto: CreateAssessmentDto, @CurrentUser() user: JwtPayload) {
    return this.assessments.create(user, dto);
  }

  @Get()
  list(@Query('type') type: string | undefined, @CurrentUser() user: JwtPayload) {
    if (!type || !ASSESSMENT_TYPES.includes(type as ActivityType)) {
      throw new BadRequestException(`type must be one of: ${ASSESSMENT_TYPES.join(', ')}`);
    }
    return this.assessments.list({ id: user.sub, role: user.role }, type as ActivityType);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.assessments.get(id, { id: user.sub, role: user.role });
  }

  @Post('attempts/:attemptId/grade')
  grade(
    @Param('attemptId') attemptId: string,
    @Body(new ZodValidationPipe(zGradeAssessmentDto)) dto: GradeAssessmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.assessments.grade({ id: user.sub, role: user.role }, attemptId, dto);
  }
}
