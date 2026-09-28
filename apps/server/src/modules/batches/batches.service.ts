import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  BatchErrorCode,
  EnrollmentSource,
  UserRole,
  type CreateBatchDto,
  type CreateClassroomDto,
  type JoinBatchDto,
  type MyBatchView,
  type UpdateBatchDto,
} from '@lab/shared';
import { Prisma } from '../../../generated/prisma';
import { classroomCodeFromName, randomCode } from '../../common/random-code';
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

// GET /batches/mine. Deliberately WITHOUT joinKey: the staff branch adds it
// on top (listMine), so the student query never selects the column at all —
// there is no code path where a student row could carry it.
const MINE_SELECT = {
  id: true,
  code: true,
  name: true,
  joinOpen: true,
  teachers: { select: { teacher: { select: { fullName: true } } } },
  _count: { select: { enrollments: true } },
} satisfies Prisma.BatchSelect;

const JOIN_KEY_LENGTH = 8;
const CREATE_CODE_ATTEMPTS = 5;

// One message for BOTH "no such code" and "wrong key" — see joinByCode.
const JOIN_INVALID_MESSAGE = "That class code or key doesn't match";
const JOIN_CLOSED_MESSAGE = "This class isn't accepting new students right now";

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Batch CRUD + roster + student self-join. See BatchAccessService for the
 * "who may use this batch" enforcement this module builds on.
 *
 * joinKey is stored PLAINTEXT, deliberately: the admin has to read it out
 * to a room of trainees (the user's own workflow — typed by hand, edited
 * later), and it is not an authenticator in its own right — the caller of
 * POST /batches/join has already proven identity with a password against
 * POST /auth/login; the key only gates which cohort an already-
 * authenticated student attaches to. It is returned only to ADMINs and to
 * a TEACHER for a class they teach (ADMIN_BATCH_SELECT / listMine's staff
 * branch) — a teacher has to read it out to their room. It is NEVER in a
 * STUDENT response, never logged into AuditLog.detail, and the join route
 * is throttled per user with a uniform failure message so it can't be used
 * as an oracle for which codes exist (see BatchesController).
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

  /**
   * A TEACHER creating their own class. The BatchTeacher link is a nested
   * write inside the same create, so it is atomic with the batch itself — a
   * teacher can never end up owning a class they are not in (or vice versa).
   *
   * Code and key are optional: a missing code is derived from the name plus
   * a random suffix, a missing key is 8 unambiguous CSPRNG characters. A
   * generated code that collides is retried; a code the teacher typed
   * themselves that collides is reported straight back as a conflict.
   */
  async createForTeacher(dto: CreateClassroomDto, user: JwtPayload) {
    const name = dto.name.trim();
    const joinKey = dto.joinKey?.trim() || randomCode(JOIN_KEY_LENGTH);
    const typedCode = dto.code ? this.normalizeCode(dto.code) : null;
    const attempts = typedCode ? 1 : CREATE_CODE_ATTEMPTS;

    for (let attempt = 0; attempt < attempts; attempt++) {
      const code = typedCode ?? classroomCodeFromName(name);
      try {
        const batch = await this.prisma.batch.create({
          data: { code, name, joinKey, joinOpen: dto.joinOpen, teachers: { create: { teacherId: user.sub } } },
          select: ADMIN_BATCH_SELECT,
        });
        await this.audit.log({ actorId: user.sub, action: 'batch.create', detail: { batchId: batch.id, code: batch.code } });
        return batch;
      } catch (err) {
        if (isUniqueViolation(err)) continue;
        throw err;
      }
    }
    throw new ConflictException(typedCode ? 'Batch code already in use' : 'Could not generate a unique class code — please try again');
  }

  /**
   * GET /batches/mine — the caller's own classes: enrolled (STUDENT), taught
   * (TEACHER) or all (ADMIN). `joinKey` is added only for staff, and the
   * property is absent — not merely undefined-valued — on a student's rows.
   */
  async listMine(user: JwtPayload): Promise<MyBatchView[]> {
    if (user.role === UserRole.STUDENT) {
      const rows = await this.prisma.batch.findMany({
        where: { enrollments: { some: { userId: user.sub } } },
        orderBy: { code: 'asc' },
        select: MINE_SELECT,
      });
      return rows.map((row) => this.toMyBatchView(row));
    }
    const rows = await this.prisma.batch.findMany({
      where: user.role === UserRole.ADMIN ? {} : { teachers: { some: { teacherId: user.sub } } },
      orderBy: { code: 'asc' },
      select: { ...MINE_SELECT, joinKey: true },
    });
    return rows.map((row) => this.toMyBatchView(row, row.joinKey));
  }

  private toMyBatchView(
    row: { id: string; code: string; name: string; joinOpen: boolean; teachers: { teacher: { fullName: string } }[]; _count: { enrollments: number } },
    joinKey?: string,
  ): MyBatchView {
    const view: MyBatchView = {
      id: row.id,
      code: row.code,
      name: row.name,
      joinOpen: row.joinOpen,
      teacherNames: row.teachers.map((t) => t.teacher.fullName),
      studentCount: row._count.enrollments,
    };
    if (joinKey !== undefined) view.joinKey = joinKey;
    return view;
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

  /**
   * ADMIN: any field. TEACHER: name / joinKey / joinOpen of a class they
   * teach — never the code, which is an institution-level identifier. The
   * ownership check is a DB lookup (BatchAccessService), not a claim in the
   * token, and runs first so a non-owner learns nothing about the request.
   */
  async update(id: string, dto: UpdateBatchDto, user: JwtPayload) {
    const actorId = user.sub;
    if (user.role !== UserRole.ADMIN) {
      await this.access.assertCanUseBatch(user, id);
      if (dto.code !== undefined) throw new ForbiddenException('Only an administrator can change a class code');
    }
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

  /** Rotates the join key. The old key stops working immediately; students
   * who already joined are untouched (enrolment is not tied to the key). */
  async regenerateKey(id: string, user: JwtPayload) {
    await this.access.assertCanUseBatch(user, id);
    const joinKey = randomCode(JOIN_KEY_LENGTH);
    try {
      await this.prisma.batch.update({ where: { id }, data: { joinKey } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') throw new NotFoundException('Batch not found');
      throw err;
    }
    // The new key itself is never written to the audit trail.
    await this.audit.log({ actorId: user.sub, action: 'batch.key_regenerated', detail: { batchId: id } });
    return { joinKey };
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

  /** ADMIN: any batch. TEACHER: only a batch they teach. */
  async unenrollStudent(batchId: string, studentId: string, user: JwtPayload) {
    await this.access.assertCanUseBatch(user, batchId);
    await this.prisma.enrollment.deleteMany({ where: { batchId, userId: studentId } });
    await this.audit.log({ actorId: user.sub, action: 'batch.unenroll', detail: { batchId, studentId } });
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
   * Student self-join, in this order:
   *  1. Caller must be a STUDENT (the controller's @Roles is the first line
   *     of defence; this is the second, so a service caller can't bypass it).
   *  2. Unknown code and wrong key produce the IDENTICAL 401 — same status,
   *     same `code`, same message — so the endpoint is never an oracle for
   *     which class codes exist. Only the audit trail records which it was.
   *  3. Already enrolled -> 200 with the existing enrolment, before the
   *     joinOpen check: a student already in a class is never told it is
   *     closed to them.
   *  4. Closed to new students -> 409 BATCH_JOIN_CLOSED. Reachable only with
   *     the right code AND key, so it leaks nothing to a guesser.
   *
   * Code matching is case-insensitive (trim + uppercase); the key is
   * case-sensitive. The key comparison is a plain !== : a constant-time
   * compare is deliberately not used — the per-user throttle on this route
   * (see BatchesController) is the real defence, and timingSafeEqual needs
   * equal-length buffers, which itself leaks key length for no real benefit
   * on an authenticated route.
   */
  async joinByCode(user: JwtPayload, dto: JoinBatchDto) {
    if (user.role !== UserRole.STUDENT) {
      throw new ForbiddenException('Only students can join a class with a code');
    }
    const userId = user.sub;
    const code = this.normalizeCode(dto.code);
    const key = dto.joinKey.trim();
    const batch = await this.prisma.batch.findUnique({ where: { code }, select: { id: true, code: true, name: true, joinKey: true, joinOpen: true } });

    if (!batch || batch.joinKey !== key) {
      await this.audit.log({ actorId: userId, action: 'batch.join_failed', detail: { code, reason: !batch ? 'unknown_code' : 'bad_key' } });
      throw new UnauthorizedException({ code: BatchErrorCode.JOIN_INVALID, message: JOIN_INVALID_MESSAGE });
    }

    const summary = { id: batch.id, code: batch.code, name: batch.name };
    const existing = await this.prisma.enrollment.findUnique({
      where: { userId_batchId: { userId, batchId: batch.id } },
      select: { id: true },
    });
    if (existing) return { ok: true, alreadyEnrolled: true, batch: summary };

    if (!batch.joinOpen) {
      await this.audit.log({ actorId: userId, action: 'batch.join_failed', detail: { code, reason: 'closed' } });
      throw new ConflictException({ code: BatchErrorCode.JOIN_CLOSED, message: JOIN_CLOSED_MESSAGE });
    }

    try {
      await this.prisma.enrollment.create({ data: { userId, batchId: batch.id, source: EnrollmentSource.SELF_JOIN } });
    } catch (err) {
      // Two concurrent joins by the same student: the @@unique([userId,
      // batchId]) is the real guarantee, so the loser is simply "already in".
      if (isUniqueViolation(err)) return { ok: true, alreadyEnrolled: true, batch: summary };
      throw err;
    }
    await this.audit.log({ actorId: userId, action: 'batch.join', detail: { batchId: batch.id, code: batch.code } });
    return { ok: true, alreadyEnrolled: false, batch: summary };
  }

  private async mustExist(batchId: string): Promise<void> {
    const exists = await this.prisma.batch.findUnique({ where: { id: batchId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Batch not found');
  }
}
