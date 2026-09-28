import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  UserRole,
  zAssignBatchTeachersDto,
  zCreateBatchDto,
  zCreateClassroomDto,
  zEnrollStudentsDto,
  zJoinBatchDto,
  zUpdateBatchDto,
  type AssignBatchTeachersDto,
  type CreateBatchDto,
  type CreateClassroomDto,
  type EnrollStudentsDto,
  type JoinBatchDto,
  type UpdateBatchDto,
} from '@lab/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.service';
import { BatchesService } from './batches.service';
import { ClassHistoryService } from './class-history.service';

// No class-level @Roles — each endpoint sets its own (ADMIN/TEACHER/
// STUDENT audiences genuinely differ here, unlike most controllers in
// this codebase which are single-audience).
@Controller('batches')
export class BatchesController {
  constructor(
    private readonly batches: BatchesService,
    private readonly classHistory: ClassHistoryService,
  ) {}

  /** ADMIN keeps the strict form (explicit code + key, no auto-link). A
   * TEACHER uses the lenient classroom form — code and key optional, and the
   * creator is linked as a teacher of the new class in the same write. The
   * body is validated per role here rather than by a single @Body pipe,
   * because the two audiences deliberately accept different shapes. */
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @Post()
  async create(@Body() body: unknown, @CurrentUser() user: JwtPayload) {
    if (user.role === UserRole.ADMIN) {
      const dto: CreateBatchDto = new ZodValidationPipe(zCreateBatchDto).transform(body);
      return this.batches.create(dto, user.sub);
    }
    const dto: CreateClassroomDto = new ZodValidationPipe(zCreateClassroomDto).transform(body);
    return this.batches.createForTeacher(dto, user);
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
  @Roles(UserRole.TEACHER, UserRole.STUDENT, UserRole.ADMIN)
  @Get('mine')
  async mine(@CurrentUser() user: JwtPayload) {
    return this.batches.listMine(user);
  }

  @Roles(UserRole.STUDENT)
  @Get('my-enrollments')
  async myEnrollments(@CurrentUser() user: JwtPayload) {
    return this.batches.listMyEnrollments(user.sub);
  }

  /** The only route where an authenticated caller can guess a shared
   * secret, typed by hand — so brute force protection is mandatory: 10
   * attempts per 10 minutes, then a 10-minute block (429).
   *
   * Keyed by USER, not IP: a whole classroom sits behind one lab-LAN (or
   * proxy) address, so an IP bucket would let one student's misses lock the
   * room out, while a student could dodge it by moving seats. JwtAuthGuard
   * and RolesGuard run before the throttler (see auth.module.ts), so
   * req.user is already set here. Every request counts, including
   * successful and already-enrolled ones. */
  @Roles(UserRole.STUDENT)
  @Throttle({
    default: {
      limit: 10,
      ttl: 600_000,
      blockDuration: 600_000,
      getTracker: (req) => `user:${req.user?.sub ?? req.ip}`,
    },
  })
  @Post('join')
  async join(@Body(new ZodValidationPipe(zJoinBatchDto)) dto: JoinBatchDto, @CurrentUser() user: JwtPayload) {
    return this.batches.joinByCode(user, dto);
  }

  /** The student app's class screen: the live activities this student took
   * part in and the assignments created from this class. Enrolled only. */
  @Roles(UserRole.STUDENT)
  @Get(':id/my-activity')
  async myActivity(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.classHistory.forStudent(user.sub, id);
  }

  @Roles(UserRole.ADMIN)
  @Get(':id')
  async get(@Param('id') id: string) {
    return this.batches.getForAdmin(id);
  }

  /** ADMIN: any field. TEACHER: name / joinKey / joinOpen of their own class
   * only — BatchesService.update enforces both the ownership and the "no
   * code change" rule (a DB lookup, so not expressible as a guard). */
  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @Patch(':id')
  async update(@Param('id') id: string, @Body(new ZodValidationPipe(zUpdateBatchDto)) dto: UpdateBatchDto, @CurrentUser() user: JwtPayload) {
    return this.batches.update(id, dto, user);
  }

  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @Post(':id/regenerate-key')
  async regenerateKey(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.batches.regenerateKey(id, user);
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

  @Roles(UserRole.ADMIN, UserRole.TEACHER)
  @Delete(':id/students/:studentId')
  async unenrollStudent(@Param('id') id: string, @Param('studentId') studentId: string, @CurrentUser() user: JwtPayload) {
    return this.batches.unenrollStudent(id, studentId, user);
  }
}
