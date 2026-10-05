import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AttemptStatus, UserRole, type AssignmentDto, type ScoreOverrideDto } from '@lab/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { JwtPayload } from '../auth/auth.service';
import { BatchAccessService } from '../batches/batch-access.service';

/**
 * Ser 4 "report tool: view, edit and save scores" + Ser 10 "teacher-
 * tailored courses". The schema's own rule (schema.prisma's ScoreOverride
 * comment): "an edit is never a silent overwrite, it's an audited
 * override." ScoreOverride keeps only the CURRENT effective override
 * (@unique attemptId) — full history of every edit lives in AuditLog,
 * written here before each overwrite, so "audited" survives even though
 * the live row itself is single-latest.
 */
@Injectable()
export class GradebookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly batchAccess: BatchAccessService,
  ) {}

  /** Fan-out create: one Assignment row per (student, exercise) pair —
   * Ser 10 "set hours... specify the score for students to attain". A pair
   * that already has an outstanding (not yet submitted) assignment is
   * skipped rather than duplicated — re-clicking Assign shouldn't pile up
   * identical rows in the student's list. A pair whose prior assignment
   * WAS submitted/scored still gets a fresh row: that's the documented
   * "send again = a new attempt" re-take path (see PronunciationTestResultsPage's
   * "Send to more students"). */
  async createAssignments(user: JwtPayload, dto: AssignmentDto) {
    const teacherId = user.sub;
    const studentIds = [...new Set(dto.studentIds)];
    const students = await this.prisma.user.findMany({
      where: { id: { in: studentIds }, role: UserRole.STUDENT, active: true },
      select: { id: true },
    });
    if (students.length !== studentIds.length) {
      const found = new Set(students.map((s) => s.id));
      throw new BadRequestException(`Not active students: ${studentIds.filter((id) => !found.has(id)).join(', ')}`);
    }

    if (dto.batchId) await this.assertClassRoster(user, dto.batchId, studentIds);

    const existing = await this.prisma.assignment.findMany({
      where: { studentId: { in: studentIds }, exerciseId: { in: dto.exerciseIds } },
      select: {
        studentId: true,
        exerciseId: true,
        attempts: { select: { status: true } },
      },
    });
    const hasOutstanding = new Set(
      existing
        .filter((a) => !a.attempts.some((t) => t.status === AttemptStatus.SUBMITTED || t.status === AttemptStatus.SCORED))
        .map((a) => `${a.studentId}:${a.exerciseId}`),
    );

    const rows = studentIds.flatMap((studentId) =>
      dto.exerciseIds
        .filter((exerciseId) => !hasOutstanding.has(`${studentId}:${exerciseId}`))
        .map((exerciseId) => ({
          teacherId,
          studentId,
          exerciseId,
          targetScore: dto.targetScore,
          allocatedHours: dto.allocatedHours,
          dueAt: dto.dueAt,
          batchId: dto.batchId,
        })),
    );
    const skipped = studentIds.length * dto.exerciseIds.length - rows.length;

    if (rows.length > 0) await this.prisma.assignment.createMany({ data: rows });
    await this.audit.log({
      actorId: teacherId,
      action: 'assignment.create',
      detail: { studentCount: studentIds.length, exerciseCount: dto.exerciseIds.length, created: rows.length, skipped },
    });
    return { created: rows.length, skipped };
  }

  /** An assignment created from a class is filed under it for the
   * students' class history, so the teacher must teach that class and
   * every student must be in it — same check as AssessmentsService's. */
  private async assertClassRoster(user: JwtPayload, batchId: string, studentIds: string[]): Promise<void> {
    await this.batchAccess.assertCanUseBatch(user, batchId);
    const enrolled = await this.prisma.enrollment.count({ where: { batchId, userId: { in: studentIds } } });
    if (enrolled !== studentIds.length) {
      throw new BadRequestException('Some of these students are not in this class');
    }
  }

  async listAssignments(filter: { studentId?: string; exerciseId?: string }) {
    return this.prisma.assignment.findMany({
      where: { studentId: filter.studentId, exerciseId: filter.exerciseId },
      include: { exercise: true, student: { select: { id: true, fullName: true, serviceNumber: true } }, attempts: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listAttempts(filter: { studentId?: string; exerciseId?: string; status?: string }) {
    return this.prisma.attempt.findMany({
      where: { studentId: filter.studentId, exerciseId: filter.exerciseId, status: filter.status },
      include: {
        exercise: { select: { id: true, title: true, type: true } },
        student: { select: { id: true, fullName: true, serviceNumber: true } },
        scoreOverride: true,
      },
      orderBy: { startedAt: 'desc' },
    });
  }

  async getAttempt(id: string) {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id },
      include: {
        exercise: true,
        student: { select: { id: true, fullName: true, serviceNumber: true } },
        itemResponses: { include: { item: true }, orderBy: { order: 'asc' } },
        scoreOverride: true,
        // Newest first: a student can re-record (Improvise) before
        // submitting, leaving several takes on one attempt — the newest
        // *ready* one is the take that was actually submitted.
        recordings: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');
    return attempt;
  }

  async override(teacherId: string, dto: ScoreOverrideDto) {
    const attempt = await this.prisma.attempt.findUnique({ where: { id: dto.attemptId }, include: { scoreOverride: true } });
    if (!attempt) throw new NotFoundException('Attempt not found');

    const oldScore = attempt.scoreOverride?.newScore ?? attempt.rawScore ?? null;

    // Full edit history — the ScoreOverride row itself only ever holds
    // the current value (schema's @unique attemptId).
    await this.audit.log({
      actorId: teacherId,
      action: 'score_override.set',
      detail: { attemptId: dto.attemptId, oldScore, newScore: dto.newScore, reason: dto.reason },
    });

    const override = await this.prisma.scoreOverride.upsert({
      where: { attemptId: dto.attemptId },
      create: { attemptId: dto.attemptId, teacherId, oldScore, newScore: dto.newScore, reason: dto.reason },
      update: { teacherId, oldScore, newScore: dto.newScore, reason: dto.reason },
    });

    await this.prisma.attempt.update({
      where: { id: dto.attemptId },
      // An override is always a 0-100 percentage (every caller sends one),
      // so the scale moves with it — keeping the activity's native maxScore
      // (e.g. 5 for pronunciation) made 10% display as 10/5 = 200%.
      data: { rawScore: dto.newScore, maxScore: 100, status: AttemptStatus.SCORED },
    });

    return override;
  }
}
