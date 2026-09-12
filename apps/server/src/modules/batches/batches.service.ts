import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EnrollmentSource, UserRole, type CreateBatchDto, type JoinBatchDto, type UpdateBatchDto } from '@lab/shared';
import { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { JwtPayload } from '../auth/auth.service';
import { BatchAccessService } from './batch-access.service';

// Prisma `select` shapes: the ADMIN shape includes joinKey, every other
// caller's does not. Two named constants (not ad hoc `include`) so "which
// response shape leaks the key" has exactly one home — see BatchesService
// doc comment below for why the key is plaintext at all.
const ADMIN_BATCH_SELECT = {
  id: true,
  code: true,
  name: true,
  joinKey: true,
  joinOpen: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { enrollments: true, teachers: true } },
} satisfies Prisma.BatchSelect;

const SAFE_BATCH_SELECT = {
  id: true,
  code: true,
  name: true,
  joinOpen: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { enrollments: true } },
} satisfies Prisma.BatchSelect;

/**
 * Batch CRUD + roster + student self-join. See BatchAccessService for the
 * "who may use this batch" enforcement this module builds on.
 *
 * joinKey is stored PLAINTEXT, deliberately: the admin has to read it out
 * to a room of trainees (the user's own workflow — typed by hand, edited
 * later), and it is not an authenticator in its own right — the caller of
 * POST /batches/join has already proven identity with a password against
 * POST /auth/login; the key only gates which cohort an already-
 * authenticated student attaches to. It is never returned to a TEACHER or
 * STUDENT response (SAFE_BATCH_SELECT), never logged into AuditLog.detail,
 * and the join route is throttled with a uniform failure message so it
 * can't be used as an oracle for which codes exist (see BatchesController).
 */
@Injectable()
export class BatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: BatchAccessService,
    private readonly audit: AuditService,
  ) {}

  private normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  async create(dto: CreateBatchDto, actorId: string) {
    try {
      const batch = await this.prisma.batch.create({
        data: {
          code: this.normalizeCode(dto.code),
          name: dto.name.trim(),
          joinKey: dto.joinKey.trim(),
          joinOpen: dto.joinOpen ?? true,
        },
        select: ADMIN_BATCH_SELECT,
      });
      await this.audit.log({ actorId, action: 'batch.create', detail: { batchId: batch.id, code: batch.code } });
      return batch;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Batch code already in use');
      }
      throw err;
    }
  }

  /** ADMIN: every batch, with joinKey. */
  async listForAdmin() {
    return this.prisma.batch.findMany({ orderBy: { code: 'asc' }, select: ADMIN_BATCH_SELECT });
  }

  /** ADMIN: every batch; TEACHER: only assigned batches. Neither ever
   * carries joinKey — used by GET /batches/mine and the GET
   * /sessions/batches delegate, both of which a teacher can read. */
  async listForPrincipal(user: JwtPayload) {
    if (user.role === UserRole.ADMIN) {
      return this.prisma.batch.findMany({ orderBy: { code: 'asc' }, select: SAFE_BATCH_SELECT });
    }
    const batchIds = await this.access.batchIdsForTeacher(user.sub);
    return this.prisma.batch.findMany({
      where: { id: { in: batchIds } },
      orderBy: { code: 'asc' },
      select: SAFE_BATCH_SELECT,
    });
  }

  async getForAdmin(id: string) {
    const batch = await this.prisma.batch.findUnique({
      where: { id },
      select: {
        ...ADMIN_BATCH_SELECT,
        teachers: { select: { teacherId: true, assignedAt: true, teacher: { select: { fullName: true, serviceNumber: true } } } },
      },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    return batch;
  }

  async update(id: string, dto: UpdateBatchDto, actorId: string) {
    try {
      const batch = await this.prisma.batch.update({
        where: { id },
        data: {
          ...(dto.code !== undefined ? { code: this.normalizeCode(dto.code) } : {}),
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.joinKey !== undefined ? { joinKey: dto.joinKey.trim() } : {}),
          ...(dto.joinOpen !== undefined ? { joinOpen: dto.joinOpen } : {}),
        },
        select: ADMIN_BATCH_SELECT,
      });
      // Field names only, never values — joinKey must never reach AuditLog.
      await this.audit.log({ actorId, action: 'batch.update', detail: { batchId: id, changed: Object.keys(dto) } });
      return batch;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') throw new ConflictException('Batch code already in use');
        if (err.code === 'P2025') throw new NotFoundException('Batch not found');
      }
      throw err;
    }
  }

  async remove(id: string, actorId: string) {
    const batch = await this.prisma.batch.findUnique({ where: { id }, select: { id: true, code: true, classSessions: { select: { id: true }, take: 1 } } });
    if (!batch) throw new NotFoundException('Batch not found');
    if (batch.classSessions.length > 0) {
      throw new ConflictException('Batch has sessions and cannot be deleted');
    }
    await this.prisma.batch.delete({ where: { id } });
    await this.audit.log({ actorId, action: 'batch.delete', detail: { batchId: id, code: batch.code } });
    return { ok: true };
  }

  async assignTeachers(batchId: string, teacherIds: string[], actorId: string) {
    await this.mustExist(batchId);
    const teachers = await this.prisma.user.findMany({ where: { id: { in: teacherIds }, role: UserRole.TEACHER }, select: { id: true } });
    if (teachers.length !== teacherIds.length) {
      throw new BadRequestException('One or more users are not teacher accounts');
    }
    await this.prisma.batchTeacher.createMany({
      data: teacherIds.map((teacherId) => ({ batchId, teacherId })),
      skipDuplicates: true,
    });
    await this.audit.log({ actorId, action: 'batch.teacher_assign', detail: { batchId, teacherIds } });
    return { ok: true };
  }

  async unassignTeacher(batchId: string, teacherId: string, actorId: string) {
    await this.prisma.batchTeacher.deleteMany({ where: { batchId, teacherId } });
    await this.audit.log({ actorId, action: 'batch.teacher_unassign', detail: { batchId, teacherId } });
    return { ok: true };
  }

  /** ADMIN: unrestricted. TEACHER: only for a batch they're assigned to. */
  async listStudents(batchId: string, user: JwtPayload) {
    await this.access.assertCanUseBatch(user, batchId);
    return this.prisma.enrollment.findMany({
      where: { batchId },
      orderBy: { enrolledAt: 'asc' },
      select: {
        userId: true,
        enrolledAt: true,
        source: true,
        user: { select: { serviceNumber: true, fullName: true, active: true } },
      },
    });
  }

  async enrollStudents(batchId: string, studentIds: string[], actorId: string) {
    await this.mustExist(batchId);
    const students = await this.prisma.user.findMany({ where: { id: { in: studentIds }, role: UserRole.STUDENT }, select: { id: true } });
    if (students.length !== studentIds.length) {
      throw new BadRequestException('One or more users are not student accounts');
    }
    await this.prisma.enrollment.createMany({
      data: studentIds.map((userId) => ({ batchId, userId, source: EnrollmentSource.ADMIN })),
      skipDuplicates: true,
    });
    await this.audit.log({ actorId, action: 'batch.enroll', detail: { batchId, count: studentIds.length } });
    return { ok: true };
  }

  async unenrollStudent(batchId: string, studentId: string, actorId: string) {
    await this.prisma.enrollment.deleteMany({ where: { batchId, userId: studentId } });
    await this.audit.log({ actorId, action: 'batch.unenroll', detail: { batchId, studentId } });
    return { ok: true };
  }

  async listMyEnrollments(userId: string) {
    return this.prisma.enrollment.findMany({
      where: { userId },
      orderBy: { enrolledAt: 'desc' },
      select: { enrolledAt: true, source: true, batch: { select: SAFE_BATCH_SELECT } },
    });
  }

  /**
   * Student self-join. Uniform failure for every secret-dependent reason
   * (unknown code, wrong key) so the endpoint is never an oracle for
   * which batch codes exist — only the non-secret "joining is closed"
   * gets a distinct message. Comparison is a plain string !== ; a
   * constant-time compare is deliberately not used here — the throttle on
   * this route (see BatchesController) is the actual defence, and
   * crypto.timingSafeEqual requires equal-length buffers, which itself
   * leaks key length for no real benefit on an authenticated route.
   */
  async joinByCode(userId: string, dto: JoinBatchDto) {
    const code = this.normalizeCode(dto.code);
    const key = dto.joinKey.trim();
    const batch = await this.prisma.batch.findUnique({ where: { code }, select: { id: true, code: true, name: true, joinKey: true, joinOpen: true } });

    if (!batch || batch.joinKey !== key) {
      await this.audit.log({ actorId: userId, action: 'batch.join_failed', detail: { code, reason: !batch ? 'unknown_code' : 'bad_key' } });
      throw new ForbiddenException('Batch ID or key is incorrect');
    }
    if (!batch.joinOpen) {
      await this.audit.log({ actorId: userId, action: 'batch.join_failed', detail: { code, reason: 'closed' } });
      throw new ForbiddenException('This batch is not accepting new members');
    }

    const existing = await this.prisma.enrollment.findUnique({
      where: { userId_batchId: { userId, batchId: batch.id } },
      select: { id: true },
    });
    if (existing) {
      return { ok: true, alreadyEnrolled: true, batch: { id: batch.id, code: batch.code, name: batch.name } };
    }

    await this.prisma.enrollment.create({ data: { userId, batchId: batch.id, source: EnrollmentSource.SELF_JOIN } });
    await this.audit.log({ actorId: userId, action: 'batch.join', detail: { batchId: batch.id, code: batch.code } });
    return { ok: true, alreadyEnrolled: false, batch: { id: batch.id, code: batch.code, name: batch.name } };
  }

  private async mustExist(batchId: string): Promise<void> {
    const exists = await this.prisma.batch.findUnique({ where: { id: batchId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Batch not found');
  }
}
