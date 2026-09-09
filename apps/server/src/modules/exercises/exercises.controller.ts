import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import {
  UserRole,
  zCreateExerciseDto,
  zImportWordListTextDto,
  zSetItemBankDto,
  zUpdateExerciseDto,
} from '@lab/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { JwtPayload } from '../auth/auth.service';
import { ExercisesService } from './exercises.service';
import { parseWordListText } from './word-list-parser';

/** Exercise authoring (Ser 4, Ser 5, Ser 10) — see exercises.service.ts's
 * doc comment for the Activity Type Registry wiring this closes. */
@Roles(UserRole.TEACHER, UserRole.ADMIN)
@Controller('exercises')
export class ExercisesController {
  constructor(private readonly exercises: ExercisesService) {}

  @Post()
  async create(
    @Body(new ZodValidationPipe(zCreateExerciseDto)) dto: ReturnType<typeof zCreateExerciseDto.parse>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.exercises.create(user.sub, dto);
  }

  @Get()
  async list() {
    return this.exercises.list();
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.exercises.get(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zUpdateExerciseDto)) dto: ReturnType<typeof zUpdateExerciseDto.parse>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.exercises.update(id, dto, { id: user.sub, role: user.role });
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.exercises.remove(id, { id: user.sub, role: user.role });
    return { ok: true };
  }

  @Get(':id/items')
  async listItems(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.exercises.listItems(id, { id: user.sub, role: user.role });
  }

  @Put(':id/items')
  async setItems(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zSetItemBankDto)) dto: ReturnType<typeof zSetItemBankDto.parse>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.exercises.setItems(id, dto.items, { id: user.sub, role: user.role });
  }

  /** Word-list import (Ser 5) as pasted text — see word-list-parser.ts for
   * the line format. A structured-JSON variant (pre-parsed items) can go
   * through PUT :id/items directly with append semantics handled client-side. */
  @Post(':id/items/import-text')
  async importText(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zImportWordListTextDto)) dto: ReturnType<typeof zImportWordListTextDto.parse>,
    @CurrentUser() user: JwtPayload,
  ) {
    let items;
    try {
      items = parseWordListText(dto.text);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    return this.exercises.importItems(id, items, dto.append, { id: user.sub, role: user.role });
  }
}
