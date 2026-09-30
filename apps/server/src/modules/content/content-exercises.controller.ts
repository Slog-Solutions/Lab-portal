import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  UserRole,
  zCreateContentExerciseDto,
  zLaunchContentExerciseDto,
  type CreateContentExerciseDto,
  type LaunchContentExerciseDto,
} from '@lab/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { JwtPayload } from '../auth/auth.service';
import { ContentExercisesService } from './content-exercises.service';

/** Ser 4 Content Exercise — teacher/admin. Score edits go through the
 * existing POST /gradebook/attempts/:id/override (audited). */
@Roles(UserRole.TEACHER, UserRole.ADMIN)
@Controller('content-exercises')
export class ContentExercisesController {
  constructor(private readonly exercises: ContentExercisesService) {}

  @Get()
  list() {
    return this.exercises.list();
  }

  @Post()
  create(@Body(new ZodValidationPipe(zCreateContentExerciseDto)) dto: CreateContentExerciseDto, @CurrentUser() user: JwtPayload) {
    return this.exercises.create(user, dto);
  }

  @Post(':id/launch')
  launch(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zLaunchContentExerciseDto)) dto: LaunchContentExerciseDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.exercises.launch(user, id, dto);
  }

  @Get(':id/report')
  report(@Param('id') id: string) {
    return this.exercises.report(id);
  }
}
