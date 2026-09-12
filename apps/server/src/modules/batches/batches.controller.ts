import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  UserRole,
  zAssignBatchTeachersDto,
  zCreateBatchDto,
  zEnrollStudentsDto,
  zJoinBatchDto,
  zUpdateBatchDto,
  type AssignBatchTeachersDto,
  type CreateBatchDto,
  type EnrollStudentsDto,
  type JoinBatchDto,
  type UpdateBatchDto,
} from '@lab/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';
import { BatchesService } from './batches.service';

// No class-level @Roles — each endpoint sets its own (ADMIN/TEACHER/
// STUDENT audiences genuinely differ here, unlike most controllers in
// this codebase which are single-audience).
@Controller('batches')
export class BatchesController {
  constructor(private readonly batches: BatchesService) {}

  @Roles(UserRole.ADMIN)
  @Post()
  async create(@Body(new ZodValidationPipe(zCreateBatchDto)) dto: CreateBatchDto, @CurrentUser() user: JwtPayload) {
    return this.batches.create(dto, user.sub);
  }

  @Roles(UserRole.ADMIN)
  @Get()
  async list() {
    return this.batches.listForAdmin();
  }

  // 'mine' / 'my-enrollments' / 'join' MUST be declared before ':id' —
  // Nest/Express matches routes in declaration order, so a literal
  // segment after a param route would be shadowed (a request for
  // /batches/mine would otherwise bind to :id = "mine"). Same footgun
  // already documented in sessions.controller.ts's 'batches' route.
  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @Get('mine')
  async mine(@CurrentUser() user: JwtPayload) {
    return this.batches.listForPrincipal(user);
  }

  @Roles(UserRole.STUDENT)
  @Get('my-enrollments')
  async myEnrollments(@CurrentUser() user: JwtPayload) {
    return this.batches.listMyEnrollments(user.sub);
  }

  /** The only route where an authenticated caller can guess a shared
   * secret. Throttled tighter than the global default and matched to
   * POST /auth/login's budget — a wrong guess here has a persistent side
   * effect (an audit trail entry), unlike /stations/claim's idempotent
   * seat assignment, so it gets the same tight budget as login rather
   * than claim's looser one. */
  @Roles(UserRole.STUDENT)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('join')
  async join(@Body(new ZodValidationPipe(zJoinBatchDto)) dto: JoinBatchDto, @CurrentUser() user: JwtPayload) {
    return this.batches.joinByCode(user.sub, dto);
  }

  @Roles(UserRole.ADMIN)
  @Get(':id')
  async get(@Param('id') id: string) {
    return this.batches.getForAdmin(id);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  async update(@Param('id') id: string, @Body(new ZodValidationPipe(zUpdateBatchDto)) dto: UpdateBatchDto, @CurrentUser() user: JwtPayload) {
    return this.batches.update(id, dto, user.sub);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.batches.remove(id, user.sub);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/teachers')
  async assignTeachers(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zAssignBatchTeachersDto)) dto: AssignBatchTeachersDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.batches.assignTeachers(id, dto.teacherIds, user.sub);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id/teachers/:teacherId')
  async unassignTeacher(@Param('id') id: string, @Param('teacherId') teacherId: string, @CurrentUser() user: JwtPayload) {
    return this.batches.unassignTeacher(id, teacherId, user.sub);
  }

  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @Get(':id/students')
  async listStudents(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.batches.listStudents(id, user);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/students')
  async enrollStudents(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(zEnrollStudentsDto)) dto: EnrollStudentsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.batches.enrollStudents(id, dto.studentIds, user.sub);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id/students/:studentId')
  async unenrollStudent(@Param('id') id: string, @Param('studentId') studentId: string, @CurrentUser() user: JwtPayload) {
    return this.batches.unenrollStudent(id, studentId, user.sub);
  }
}
