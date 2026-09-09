import { Injectable, NotFoundException } from '@nestjs/common';
import { AttemptStatus, type AssignmentDto, type ScoreOverrideDto } from '@lab/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

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
  ) {}

  /** Fan-out create: one Assignment row per (student, exercise) pair —
   * Ser 10 "set hours... specify the score for students to attain". */
  async createAssignments(teacherId: string, dto: AssignmentDto) {
    const rows = dto.studentIds.flatMap((studentId) =>
      dto.exerciseIds.map((exerciseId) => ({
        teacherId,
        studentId,
        exerciseId,
        targetScore: dto.targetScore,
        allocatedHours: dto.allocatedHours,
        dueAt: dto.dueAt,
      })),
    );
    await this.prisma.assignment.createMany({ data: rows });
    await this.audit.log({
      actorId: teacherId,
      action: 'assignment.create',
      detail: { studentCount: dto.studentIds.length, exerciseCount: dto.exerciseIds.length },
    });
    return { created: rows.length };
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
        recordings: true,
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
      data: { rawScore: dto.newScore, status: AttemptStatus.SCORED },
    });

    return override;
  }
}
