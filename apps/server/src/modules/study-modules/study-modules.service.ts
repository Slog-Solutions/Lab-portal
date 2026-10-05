import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MediaAssetScope, type CreateStudyModuleDto, type UpdateStudyModuleDto } from '@lab/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const MATERIAL_SELECT = { id: true, title: true, filename: true, kind: true, mimeType: true, sizeBytes: true } as const;

/** The student-facing shape of a library file (a module's material or a loose visible file). */
function toMaterial(a: { id: string; title: string | null; filename: string; kind: string; mimeType: string; sizeBytes: number }) {
  return { id: a.id, title: a.title ?? a.filename, filename: a.filename, kind: a.kind, mimeType: a.mimeType, sizeBytes: a.sizeBytes };
}

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
 *
 * A module can also carry uploaded files (`materialAssetIds` — worksheets,
 * PDFs, audio, video, images), stored as ordinary MediaAssets. They are
 * resolved the same tolerant way, and must not be PRIVATE: a student seat
 * reads them with its station token, which is never the owner of a private
 * asset (see MediaAssetsService.assertReadable).
 */
@Injectable()
export class StudyModulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateStudyModuleDto, actorId: string) {
    await this.requireExercisesExist(dto.exerciseIds);
    await this.requireMaterialsShareable(dto.materialAssetIds);
    const module = await this.prisma.studyModule.create({
      data: { title: dto.title, description: dto.description || null, exerciseIds: dto.exerciseIds, materialAssetIds: dto.materialAssetIds },
    });
    await this.audit.log({ actorId, action: 'study_module.create', detail: { studyModuleId: module.id } });
    return this.resolve(module);
  }

  async update(id: string, dto: UpdateStudyModuleDto, actorId: string) {
    const existing = await this.prisma.studyModule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Study module not found');
    if (dto.exerciseIds) await this.requireExercisesExist(dto.exerciseIds);
    if (dto.materialAssetIds) await this.requireMaterialsShareable(dto.materialAssetIds);
    const exerciseCount = (dto.exerciseIds ?? existing.exerciseIds).length;
    const materialCount = (dto.materialAssetIds ?? existing.materialAssetIds).length;
    if (exerciseCount + materialCount === 0) throw new BadRequestException('A study module needs at least one exercise or uploaded file');

    const module = await this.prisma.studyModule.update({
      where: { id },
      // `undefined` leaves the description alone; an empty string clears it.
      data: {
        title: dto.title,
        description: dto.description === undefined ? undefined : dto.description || null,
        exerciseIds: dto.exerciseIds,
        materialAssetIds: dto.materialAssetIds,
      },
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
   * ClassSession/teacher presence required. It is the teacher's Study Library
   * and nothing else: the same resolved modules, minus any whose exercises
   * and files have all since been deleted (an empty shell would only show a
   * student a title with nothing behind it).
   */
  async library() {
    const modules = await this.list();
    return modules.filter((m) => m.exercises.length + m.materials.length > 0);
  }

  /**
   * The other half of what a student sees: files a teacher uploaded to the
   * library and switched on for students (`studentVisible`), not tied to any
   * module. A file already attached to a module is left out — the student
   * reaches it inside that module, and listing it twice would only confuse.
   * Scope is re-checked here on top of the flag (MediaAssetsService refuses
   * to save the two together, but a PRIVATE file would 403 for a seat anyway).
   *
   * A file aimed at particular classes (`sharedBatchIds`) is listed only for a
   * student enrolled in one of them; one aimed at none is listed for everyone.
   * Who "the student" is comes from the seat's station: whoever is signed in
   * there right now, or nobody (then only the all-students files show). This
   * narrows what is *listed*; it is not an access check on the file itself —
   * a station token can still open any non-PRIVATE asset by id, as it can for
   * module files.
   *
   * Each file carries the Study Library folder the teacher filed it in (or
   * null), so the student sees the same folders the teacher made.
   */
  async libraryFiles(stationId: string) {
    const classIds = await this.enrolledBatchIds(stationId);
    const [visible, modules] = await Promise.all([
      this.prisma.mediaAsset.findMany({
        where: {
          studentVisible: true,
          scope: { not: MediaAssetScope.PRIVATE },
          OR: [{ sharedBatchIds: { isEmpty: true } }, { sharedBatchIds: { hasSome: classIds } }],
        },
        orderBy: { createdAt: 'desc' },
        select: { ...MATERIAL_SELECT, folder: { select: { id: true, name: true } } },
      }),
      this.prisma.studyModule.findMany({ select: { materialAssetIds: true } }),
    ]);
    const inModules = new Set(modules.flatMap((m) => m.materialAssetIds));
    return visible.filter((a) => !inModules.has(a.id)).map((a) => ({ ...toMaterial(a), folder: a.folder ?? null }));
  }

  /** Classes of the student currently seated at this station (none if the seat is unclaimed). */
  private async enrolledBatchIds(stationId: string): Promise<string[]> {
    const station = await this.prisma.station.findUnique({
      where: { id: stationId },
      select: { currentUser: { select: { enrollments: { select: { batchId: true } } } } },
    });
    return station?.currentUser?.enrollments.map((e) => e.batchId) ?? [];
  }

  private async requireExercisesExist(exerciseIds: string[]): Promise<void> {
    const found = await this.prisma.exercise.findMany({ where: { id: { in: exerciseIds } }, select: { id: true } });
    if (found.length !== exerciseIds.length) {
      const foundIds = new Set(found.map((e) => e.id));
      const missing = exerciseIds.filter((id) => !foundIds.has(id));
      throw new BadRequestException(`Unknown exercise id(s): ${missing.join(', ')}`);
    }
  }

  private async requireMaterialsShareable(assetIds: string[]): Promise<void> {
    if (assetIds.length === 0) return;
    const found = await this.prisma.mediaAsset.findMany({ where: { id: { in: assetIds } }, select: { id: true, scope: true } });
    const foundIds = new Set(found.map((a) => a.id));
    const missing = assetIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) throw new BadRequestException(`Unknown file id(s): ${missing.join(', ')}`);
    if (found.some((a) => a.scope === MediaAssetScope.PRIVATE)) {
      throw new BadRequestException('A private file cannot be attached to a study module — students could not open it');
    }
  }

  private async resolve(module: {
    id: string;
    title: string;
    description: string | null;
    exerciseIds: string[];
    materialAssetIds: string[];
    createdAt: Date;
  }) {
    const [exercises, assets] = await Promise.all([
      this.prisma.exercise.findMany({
        where: { id: { in: module.exerciseIds } },
        select: { id: true, title: true, type: true },
      }),
      this.prisma.mediaAsset.findMany({
        where: { id: { in: module.materialAssetIds } },
        select: MATERIAL_SELECT,
      }),
    ]);
    const assetById = new Map(assets.map((a) => [a.id, a]));
    const materials = module.materialAssetIds
      .map((id) => assetById.get(id))
      .filter((a): a is NonNullable<typeof a> => Boolean(a))
      .map(toMaterial);
    const byId = new Map(exercises.map((e) => [e.id, e]));
    // Preserve authored order and silently drop ids whose Exercise was
    // since deleted, rather than surfacing a broken reference to a student.
    const resolvedExercises = module.exerciseIds.map((id) => byId.get(id)).filter((e): e is NonNullable<typeof e> => Boolean(e));
    return { id: module.id, title: module.title, description: module.description, createdAt: module.createdAt, exercises: resolvedExercises, materials };
  }
}
