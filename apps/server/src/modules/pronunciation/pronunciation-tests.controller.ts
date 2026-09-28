import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  UserRole,
  zCreatePronunciationTestDto,
  zGradePronunciationTestDto,
  type GradePronunciationTestDto,
} from '@lab/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { JwtPayload } from '../auth/auth.service';
import { PronunciationTestsService } from './pronunciation-tests.service';

/** Teacher-run pronunciation tests (Ser 7) — see the service's doc
 * comment. Sending a test to more students later reuses the existing
 * POST /gradebook/assignments, so there is no endpoint for it here. */
@Roles(UserRole.TEACHER, UserRole.ADMIN)
@Controller('pronunciation/tests')
export class PronunciationTestsController {
  constructor(private readonly tests: PronunciationTestsService) {}

  @Post()
  create(
    @Body(new ZodValidationPipe(zCreatePronunciationTestDto)) dto: ReturnType<typeof zCreatePronunciationTestDto.parse>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.tests.create(user.sub, dto);
  }

  @Get()
  list() {
    return this.tests.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.tests.get(id);
  }

  @Post('attempts/:attemptId/grade')
  grade(
    @Param('attemptId') attemptId: string,
    @Body(new ZodValidationPipe(zGradePronunciationTestDto)) dto: GradePronunciationTestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.tests.grade(user.sub, attemptId, dto);
  }
}
