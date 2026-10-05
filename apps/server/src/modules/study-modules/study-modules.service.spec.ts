import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { MediaAssetScope, zCreateStudyModuleDto } from '@lab/shared';
import { StudyModulesService } from './study-modules.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

const EX1 = 'clh3am1r30000qzrmn831i7a';
const ASSET1 = 'clh3am1r30000qzrmn831i7b';
const ASSET2 = 'clh3am1r30000qzrmn831i7c';

function asset(id: string, over: Record<string, unknown> = {}) {
  return { id, title: null, filename: `${id}.pdf`, kind: 'text', mimeType: 'application/pdf', sizeBytes: 2048, scope: MediaAssetScope.INSTITUTION, ...over };
}

function makeSvc(mediaAssets: Array<ReturnType<typeof asset>> = []) {
  const prisma = {
    studyModule: {
      create: vi.fn().mockImplementation(({ data }) => ({ id: 'mod1', createdAt: new Date(), ...data })),
      // Like Prisma, an `undefined` field in `data` leaves the stored value alone.
      update: vi.fn().mockImplementation(({ data }) => ({
        id: 'mod1',
        title: 'T',
        exerciseIds: [],
        materialAssetIds: [],
        createdAt: new Date(),
        ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
      })),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    exercise: {
      findMany: vi.fn().mockImplementation(({ where }) => (where.id.in as string[]).map((id) => ({ id, title: 'Ex', type: 'VOCABULARY_TEST' }))),
    },
    mediaAsset: {
      findMany: vi.fn().mockImplementation(({ where }) => mediaAssets.filter((a) => (where.id.in as string[]).includes(a.id))),
    },
    station: { findUnique: vi.fn().mockResolvedValue({ currentUser: { enrollments: [] } }) },
  };
  const audit = { log: vi.fn() };
  return { svc: new StudyModulesService(prisma as unknown as PrismaService, audit as unknown as AuditService), prisma };
}

describe('zCreateStudyModuleDto', () => {
  it('accepts a module made only of uploaded files', () => {
    expect(zCreateStudyModuleDto.parse({ title: 'Worksheets', materialAssetIds: [ASSET1] })).toEqual({
      title: 'Worksheets',
      exerciseIds: [],
      materialAssetIds: [ASSET1],
    });
  });

  it('trims the description and rejects one over 2000 characters', () => {
    expect(zCreateStudyModuleDto.parse({ title: 'M', description: '  Read first, then practise.  ', exerciseIds: [EX1] }).description).toBe(
      'Read first, then practise.',
    );
    expect(() => zCreateStudyModuleDto.parse({ title: 'M', description: 'x'.repeat(2001), exerciseIds: [EX1] })).toThrow();
  });

  it('rejects a module with neither exercises nor files', () => {
    expect(() => zCreateStudyModuleDto.parse({ title: 'Empty' })).toThrow();
  });
});

describe('StudyModulesService materials', () => {
  it('creates a files-only module and resolves the files for students', async () => {
    const { svc, prisma } = makeSvc([asset(ASSET1, { title: 'Unit 1 worksheet' })]);

    const result = await svc.create({ title: 'Worksheets', exerciseIds: [], materialAssetIds: [ASSET1] }, 'teacher1');

    expect(prisma.studyModule.create).toHaveBeenCalledWith({
      data: { title: 'Worksheets', description: null, exerciseIds: [], materialAssetIds: [ASSET1] },
    });
    expect(result.materials).toEqual([
      { id: ASSET1, title: 'Unit 1 worksheet', filename: `${ASSET1}.pdf`, kind: 'text', mimeType: 'application/pdf', sizeBytes: 2048 },
    ]);
  });

  it('falls back to the filename when the file has no title', async () => {
    const { svc } = makeSvc([asset(ASSET1)]);
    const result = await svc.create({ title: 'M', exerciseIds: [EX1], materialAssetIds: [ASSET1] }, 'teacher1');
    expect(result.materials[0]?.title).toBe(`${ASSET1}.pdf`);
  });

  it('rejects a file id that does not exist', async () => {
    const { svc, prisma } = makeSvc([]);
    await expect(svc.create({ title: 'M', exerciseIds: [], materialAssetIds: [ASSET1] }, 'teacher1')).rejects.toThrow(/Unknown file id/);
    expect(prisma.studyModule.create).not.toHaveBeenCalled();
  });

  it('rejects a PRIVATE file — a student seat could never open it', async () => {
    const { svc, prisma } = makeSvc([asset(ASSET1, { scope: MediaAssetScope.PRIVATE })]);
    await expect(svc.create({ title: 'M', exerciseIds: [], materialAssetIds: [ASSET1] }, 'teacher1')).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.studyModule.create).not.toHaveBeenCalled();
  });

  it('keeps authored order and drops a file deleted from the Media Library since', async () => {
    const { svc, prisma } = makeSvc([asset(ASSET2)]); // ASSET1 no longer exists
    prisma.studyModule.findUnique.mockResolvedValue({ id: 'mod1', title: 'M', exerciseIds: [], materialAssetIds: [ASSET1, ASSET2], createdAt: new Date() });

    const result = await svc.get('mod1');

    expect(result.materials.map((m) => m.id)).toEqual([ASSET2]);
  });

  it('update: refuses to remove the last file from a module with no exercises', async () => {
    const { svc, prisma } = makeSvc([asset(ASSET1)]);
    prisma.studyModule.findUnique.mockResolvedValue({ id: 'mod1', title: 'M', exerciseIds: [], materialAssetIds: [ASSET1], createdAt: new Date() });

    await expect(svc.update('mod1', { materialAssetIds: [] }, 'teacher1')).rejects.toThrow(/at least one/);
    expect(prisma.studyModule.update).not.toHaveBeenCalled();
  });

  it('update: removing the last file is fine when the module still has exercises', async () => {
    const { svc, prisma } = makeSvc([asset(ASSET1)]);
    prisma.studyModule.findUnique.mockResolvedValue({ id: 'mod1', title: 'M', exerciseIds: [EX1], materialAssetIds: [ASSET1], createdAt: new Date() });

    await svc.update('mod1', { materialAssetIds: [] }, 'teacher1');

    expect(prisma.studyModule.update).toHaveBeenCalledWith({
      where: { id: 'mod1' },
      data: { title: undefined, description: undefined, exerciseIds: undefined, materialAssetIds: [] },
    });
  });
});

describe('StudyModulesService description', () => {
  it("stores the teacher's guidance and returns it", async () => {
    const { svc, prisma } = makeSvc();
    const result = await svc.create({ title: 'M', description: 'Listen twice, then do the quiz.', exerciseIds: [EX1], materialAssetIds: [] }, 'teacher1');

    expect(prisma.studyModule.create).toHaveBeenCalledWith({
      data: { title: 'M', description: 'Listen twice, then do the quiz.', exerciseIds: [EX1], materialAssetIds: [] },
    });
    expect(result.description).toBe('Listen twice, then do the quiz.');
  });

  it('update: an empty string clears the description, an omitted one leaves it alone', async () => {
    const { svc, prisma } = makeSvc();
    prisma.studyModule.findUnique.mockResolvedValue({ id: 'mod1', title: 'M', description: 'old', exerciseIds: [EX1], materialAssetIds: [], createdAt: new Date() });

    await svc.update('mod1', { description: '' }, 'teacher1');
    expect(prisma.studyModule.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ description: null }) }));

    await svc.update('mod1', { title: 'Renamed' }, 'teacher1');
    expect(prisma.studyModule.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ description: undefined }) }));
  });
});

describe('StudyModulesService.library (what students see)', () => {
  const row = (id: string, exerciseIds: string[], materialAssetIds: string[]) => ({
    id,
    title: id,
    description: null,
    exerciseIds,
    materialAssetIds,
    createdAt: new Date(),
  });

  it('is the teacher library minus modules whose exercises and files are all gone', async () => {
    const { svc, prisma } = makeSvc([asset(ASSET1)]);
    prisma.studyModule.findMany.mockResolvedValue([
      row('with-exercise', [EX1], []),
      row('with-file', [], [ASSET1]),
      row('files-deleted', [], [ASSET2]), // ASSET2 no longer exists
    ]);
    prisma.exercise.findMany.mockImplementation(({ where }) => (where.id.in as string[]).filter((id) => id === EX1).map((id) => ({ id, title: 'Ex', type: 'VOCABULARY_TEST' })));

    const library = await svc.library();

    expect(library.map((m) => m.id)).toEqual(['with-exercise', 'with-file']);
  });

  it('list() (the teacher view) still shows an empty module so it can be repaired or deleted', async () => {
    const { svc, prisma } = makeSvc();
    prisma.studyModule.findMany.mockResolvedValue([row('files-deleted', [], [ASSET2])]);
    prisma.exercise.findMany.mockResolvedValue([]);

    expect((await svc.list()).map((m) => m.id)).toEqual(['files-deleted']);
  });
});

describe('StudyModulesService.libraryFiles (loose files students see)', () => {
  const CLASS_A = 'clh3am1r30000qzrmn831i7a';
  const CLASS_B = 'clh3am1r30000qzrmn831i7b';

  it('asks for student-visible, non-private assets that are for everyone or for the seated student\'s classes', async () => {
    const { svc, prisma } = makeSvc();
    prisma.mediaAsset.findMany.mockResolvedValue([]);
    prisma.studyModule.findMany.mockResolvedValue([]);
    prisma.station.findUnique.mockResolvedValue({ currentUser: { enrollments: [{ batchId: CLASS_A }, { batchId: CLASS_B }] } });

    await svc.libraryFiles('station1');

    expect(prisma.station.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'station1' } }));
    expect(prisma.mediaAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          studentVisible: true,
          scope: { not: MediaAssetScope.PRIVATE },
          OR: [{ sharedBatchIds: { isEmpty: true } }, { sharedBatchIds: { hasSome: [CLASS_A, CLASS_B] } }],
        },
      }),
    );
  });

  it('an unclaimed seat (nobody signed in) matches only files with no class named', async () => {
    const { svc, prisma } = makeSvc();
    prisma.mediaAsset.findMany.mockResolvedValue([]);
    prisma.studyModule.findMany.mockResolvedValue([]);
    prisma.station.findUnique.mockResolvedValue({ currentUser: null });

    await svc.libraryFiles('station1');

    expect(prisma.mediaAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ OR: [{ sharedBatchIds: { isEmpty: true } }, { sharedBatchIds: { hasSome: [] } }] }) }),
    );
  });

  it('leaves out files already attached to a module, and falls back to the filename as title', async () => {
    const { svc, prisma } = makeSvc();
    prisma.mediaAsset.findMany.mockResolvedValue([asset(ASSET1, { title: 'Worksheet' }), asset(ASSET2)]);
    prisma.studyModule.findMany.mockResolvedValue([{ materialAssetIds: [ASSET1] }]);

    const files = await svc.libraryFiles('station1');

    expect(files).toEqual([{ id: ASSET2, title: `${ASSET2}.pdf`, filename: `${ASSET2}.pdf`, kind: 'text', mimeType: 'application/pdf', sizeBytes: 2048, folder: null }]);
  });

  it('tells the student which teacher folder each file is in', async () => {
    const { svc, prisma } = makeSvc();
    const folder = { id: 'clh3am1r30000qzrmn831f01', name: 'A1 Listening' };
    prisma.mediaAsset.findMany.mockResolvedValue([asset(ASSET1, { folder })]);
    prisma.studyModule.findMany.mockResolvedValue([]);

    const files = await svc.libraryFiles('station1');

    expect(prisma.mediaAsset.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ folder: { select: { id: true, name: true } } }) }));
    expect(files[0]?.folder).toEqual(folder);
  });
});
