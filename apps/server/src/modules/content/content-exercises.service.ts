import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ActivityType,
  AttemptStatus,
  CommandType,
  UserRole,
  type CreateContentExerciseDto,
  type LaunchContentExerciseDto,
} from '@lab/shared';
import type { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BatchAccessService } from '../batches/batch-access.service';
import { CommandsService } from '../control/commands.service';
import { GradebookService } from '../gradebook/gradebook.service';
import type { JwtPayload } from '../auth/auth.service';
import { ContentPackagesService } from './content-packages.service';

interface ContentConfig {
  contentPackageId: string;
  gradeLevel: string;
  cefrLevel?: string;
}

/** What the player stored in Attempt.answers on submit (the SCORM-reported
 * score plus one row per interaction the package reported). */
interface StoredResponse {
  score: number;
  itemResults: Array<{ itemId: string; correct: boolean; prompt?: string; given?: string; expected?: string }>;
}

/**
 * Ser 4 Content Exercise, teacher side: the catalogue (ready-made and
 * imported publisher content, grade- and level-wise), launching an exercise
 * to a class or to students — optionally straight onto the screens where
 * they are signed in — and the report tool's detailed score listing (scores
 * are edited and saved through GradebookService.override, which audits it).
 */
@Injectable()
export class ContentExercisesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly packages: ContentPackagesService,
    private readonly gradebook: GradebookService,
    private readonly commands: CommandsService,
    private readonly batchAccess: BatchAccessService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const exercises = await this.prisma.exercise.findMany({
      where: { type: ActivityType.CONTENT_EXERCISE },
      orderBy: { createdAt: 'desc' },
      include: {
        teacher: { select: { fullName: true } },
        _count: { select: { assignments: true } },
        attempts: { where: { status: AttemptStatus.SCORED }, select: { studentId: true, rawScore: true, scoreOverride: { select: { newScore: true } } } },
      },
    });
    const packageIds = [...new Set(exercises.map((e) => (e.config as unknown as ContentConfig).contentPackageId))];
    const pkgs = await this.prisma.contentPackage.findMany({ where: { id: { in: packageIds } } });
    const byId = new Map(pkgs.map((p) => [p.id, p]));
    return exercises.map((e) => {
      const config = e.config as unknown as ContentConfig;
      const pkg = byId.get(config.contentPackageId);
      const scores = e.attempts.map((a) => a.scoreOverride?.newScore ?? a.rawScore).filter((s): s is number => s !== null);
      return {
        id: e.id,
        title: e.title,
        builtin: e.catalogKey?.startsWith('content:') ?? false,
        teacherName: e.teacher?.fullName ?? null,
        createdAt: e.createdAt,
        gradeLevel: config.gradeLevel,
        cefrLevel: config.cefrLevel ?? pkg?.cefrLevel ?? null,
        package: pkg
          ? { id: pkg.id, title: pkg.title, publisher: pkg.publisher, format: pkg.format, entryPoint: pkg.entryPoint, description: pkg.description }
          : null,
        assigned: e._count.assignments,
        completedBy: new Set(e.attempts.map((a) => a.studentId)).size,
        average: scores.length ? Math.round((scores.reduce((s, x) => s + x, 0) / scores.length) * 10) / 10 : null,
      };
    });
  }

  async create(user: JwtPayload, dto: CreateContentExerciseDto) {
    await this.packages.get(dto.contentPackageId, { id: user.sub, role: user.role });
    const exercise = await this.prisma.exercise.create({
      data: {
        teacherId: user.sub,
        type: ActivityType.CONTENT_EXERCISE,
        title: dto.title,
        config: { contentPackageId: dto.contentPackageId, gradeLevel: dto.gradeLevel, ...(dto.cefrLevel ? { cefrLevel: dto.cefrLevel } : {}) } as Prisma.InputJsonValue,
      },
    });
    await this.audit.log({ actorId: user.sub, action: 'content_exercise.create', detail: { exerciseId: exercise.id, packageId: dto.contentPackageId } });
    return exercise;
  }

  /** Assign to a class (every enrolled student) or to chosen students; with
   * `openNow`, every seat where one of them is signed in opens it at once. */
  async launch(user: JwtPayload, exerciseId: string, dto: LaunchContentExerciseDto) {
    await this.requireContentExercise(exerciseId);
    let studentIds = [...new Set(dto.studentIds)];
    if (dto.batchId) {
      await this.batchAccess.assertCanUseBatch(user, dto.batchId);
      const enrolled = await this.prisma.enrollment.findMany({
        where: { batchId: dto.batchId, user: { role: UserRole.STUDENT, active: true } },
        select: { userId: true },
      });
      // A class launch goes to that class's roster (the assignment is filed
      // under the class, so it may only name students who are in it).
      studentIds = enrolled.map((e) => e.userId);
      if (studentIds.length === 0) throw new BadRequestException('This class has no students yet');
    }
    const result = await this.gradebook.createAssignments(user, { studentIds, exerciseIds: [exerciseId], dueAt: dto.dueAt, batchId: dto.batchId });

    let opened = 0;
    if (dto.openNow) {
      const [seats, assignments] = await Promise.all([
        this.prisma.station.findMany({ where: { currentUserId: { in: studentIds } }, select: { id: true, currentUserId: true } }),
        this.prisma.assignment.findMany({
          where: { exerciseId, studentId: { in: studentIds } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, studentId: true, exercise: { select: { title: true } } },
        }),
      ]);
      const latestFor = new Map<string, (typeof assignments)[number]>();
      for (const a of assignments) if (!latestFor.has(a.studentId)) latestFor.set(a.studentId, a);
      for (const seat of seats) {
        const assignment = latestFor.get(seat.currentUserId!);
        if (!assignment) continue;
        // No actor: this only opens work the student has just been given, on
        // the seat they are signed in at — it controls nothing else.
        await this.commands.send(
          { kind: 'stations', stationIds: [seat.id] },
          CommandType.OPEN_ASSIGNMENT,
          { exerciseId, assignmentId: assignment.id, title: assignment.exercise.title },
        );
        opened += 1;
      }
    }
    await this.audit.log({ actorId: user.sub, action: 'content_exercise.launch', detail: { exerciseId, batchId: dto.batchId, students: studentIds.length, opened } });
    return { students: studentIds.length, created: result.created, skipped: result.skipped, openedOnSeats: opened };
  }

  /** Ser 4 "Report tool ... a detailed listing of student scores": one row
   * per student who was given or took it — latest attempt, the package's
   * score, any teacher edit, time taken, and every answer it reported. */
  async report(exerciseId: string) {
    const exercise = await this.requireContentExercise(exerciseId);
    const config = exercise.config as unknown as ContentConfig;
    const [pkg, assignments, attempts] = await Promise.all([
      this.prisma.contentPackage.findUnique({ where: { id: config.contentPackageId }, select: { title: true, publisher: true } }),
      this.prisma.assignment.findMany({
        where: { exerciseId },
        select: { studentId: true, dueAt: true, createdAt: true, student: { select: { fullName: true, serviceNumber: true } } },
      }),
      this.prisma.attempt.findMany({
        where: { exerciseId },
        orderBy: { startedAt: 'desc' },
        include: { student: { select: { fullName: true, serviceNumber: true } }, scoreOverride: true },
      }),
    ]);

    const students = new Map<string, { fullName: string; serviceNumber: string; dueAt: Date | null }>();
    for (const a of assignments) students.set(a.studentId, { ...a.student, dueAt: a.dueAt });
    for (const t of attempts) if (!students.has(t.studentId)) students.set(t.studentId, { ...t.student, dueAt: null });

    const rows = [...students.entries()].map(([studentId, s]) => {
      const mine = attempts.filter((t) => t.studentId === studentId);
      const latest = mine.find((t) => t.status === AttemptStatus.SCORED) ?? mine[0] ?? null;
      const stored = (latest?.answers ?? null) as unknown as StoredResponse | null;
      return {
        studentId,
        fullName: s.fullName,
        serviceNumber: s.serviceNumber,
        dueAt: s.dueAt,
        attempts: mine.length,
        attempt: latest && {
          id: latest.id,
          status: latest.status,
          // GradebookService.override rewrites rawScore too, so an edited
          // attempt's previous score lives on its ScoreOverride row.
          packageScore: latest.scoreOverride ? latest.scoreOverride.oldScore : latest.rawScore,
          score: latest.scoreOverride?.newScore ?? latest.rawScore,
          edited: latest.scoreOverride ? { oldScore: latest.scoreOverride.oldScore, reason: latest.scoreOverride.reason, at: latest.scoreOverride.createdAt } : null,
          startedAt: latest.startedAt,
          submittedAt: latest.submittedAt,
          durationSec: latest.submittedAt ? Math.round((latest.submittedAt.getTime() - latest.startedAt.getTime()) / 1000) : null,
          items: stored?.itemResults ?? [],
        },
      };
    });
    rows.sort((a, b) => a.fullName.localeCompare(b.fullName));
    const scores = rows
      .filter((r) => r.attempt?.status === AttemptStatus.SCORED)
      .map((r) => r.attempt!.score)
      .filter((s): s is number => s !== null);
    return {
      exercise: { id: exercise.id, title: exercise.title, gradeLevel: config.gradeLevel, cefrLevel: config.cefrLevel ?? null, package: pkg },
      summary: {
        students: rows.length,
        completed: rows.filter((r) => r.attempt?.status === AttemptStatus.SCORED).length,
        average: scores.length ? Math.round((scores.reduce((s, x) => s + x, 0) / scores.length) * 10) / 10 : null,
      },
      rows,
    };
  }

  private async requireContentExercise(id: string) {
    const exercise = await this.prisma.exercise.findUnique({ where: { id } });
    if (!exercise || exercise.type !== ActivityType.CONTENT_EXERCISE) throw new NotFoundException('Content exercise not found');
    return exercise;
  }
}
