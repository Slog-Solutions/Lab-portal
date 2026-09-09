import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateStudyModuleDto, UpdateStudyModuleDto } from '@lab/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * Self-study content library (Annexure-I Ser 1: "session modules for
 * students... self-study even when teacher not present" / Ser 10
 * "CEFR-aligned worksheets across 4 key skills"). A StudyModule is
 * deliberately just a named, ordered list of existing Exercise ids —
 * every exercise inside it already has a real player (VOCABULARY_TEST,
 * CONTENT_EXERCISE, PRONUNCIATION — the same ATTEMPTABLE_TYPES
 * attempts.service.ts already knows how to serve/score), so this module
 * adds no new grading/serving logic, only curation and browsing. That is
 * the whole point: a teacher curates once, and the library is reachable
 * from the student console with no live ClassSession/teacher presence
 * required at all — the literal "teacher absent" requirement.
 *
 * `exerciseIds` is a plain string[] (see schema.prisma's comment on
 * StudyModule), not a relation, so membership is resolved here rather
 * than via Prisma include — a module can reference an exercise that was
 * since deleted, and this filters those out rather than 500ing or
 * leaving a dangling id in the response.
 */
@Injectable()
export class StudyModulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateStudyModuleDto, actorId: string) {
    await this.requireExercisesExist(dto.exerciseIds);
    const module = await this.prisma.studyModule.create({
      data: { title: dto.title, exerciseIds: dto.exerciseIds },
    });
    await this.audit.log({ actorId, action: 'study_module.create', detail: { studyModuleId: module.id } });
    return this.resolve(module);
  }

  async update(id: string, dto: UpdateStudyModuleDto, actorId: string) {
    const existing = await this.prisma.studyModule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Study module not found');
    if (dto.exerciseIds) await this.requireExercisesExist(dto.exerciseIds);

    const module = await this.prisma.studyModule.update({
      where: { id },
      data: { title: dto.title, exerciseIds: dto.exerciseIds },
    });
    await this.audit.log({ actorId, action: 'study_module.update', detail: { studyModuleId: id } });
    return this.resolve(module);
  }

  async remove(id: string, actorId: string): Promise<void> {
    await this.prisma.studyModule.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('Study module not found');
    });
    await this.audit.log({ actorId, action: 'study_module.delete', detail: { studyModuleId: id } });
  }

  /** Teacher/admin authoring list — every module, resolved. */
  async list() {
    const modules = await this.prisma.studyModule.findMany({ orderBy: { createdAt: 'desc' } });
    return Promise.all(modules.map((m) => this.resolve(m)));
  }

  async get(id: string) {
    const module = await this.prisma.studyModule.findUnique({ where: { id } });
    if (!module) throw new NotFoundException('Study module not found');
    return this.resolve(module);
  }

  /**
   * The student-facing library (Ser 1) — station-authenticated, no
   * ClassSession/teacher presence required. Same resolved shape as the
   * authoring list; the station-side UI just doesn't get edit affordances.
   */
  async library() {
    return this.list();
  }

  private async requireExercisesExist(exerciseIds: string[]): Promise<void> {
    const found = await this.prisma.exercise.findMany({ where: { id: { in: exerciseIds } }, select: { id: true } });
    if (found.length !== exerciseIds.length) {
      const foundIds = new Set(found.map((e) => e.id));
      const missing = exerciseIds.filter((id) => !foundIds.has(id));
      throw new BadRequestException(`Unknown exercise id(s): ${missing.join(', ')}`);
    }
  }

  private async resolve(module: { id: string; title: string; exerciseIds: string[]; createdAt: Date }) {
    const exercises = await this.prisma.exercise.findMany({
      where: { id: { in: module.exerciseIds } },
      select: { id: true, title: true, type: true },
    });
    const byId = new Map(exercises.map((e) => [e.id, e]));
    // Preserve authored order and silently drop ids whose Exercise was
    // since deleted, rather than surfacing a broken reference to a student.
    const resolvedExercises = module.exerciseIds.map((id) => byId.get(id)).filter((e): e is NonNullable<typeof e> => Boolean(e));
    return { id: module.id, title: module.title, createdAt: module.createdAt, exercises: resolvedExercises };
  }
}
