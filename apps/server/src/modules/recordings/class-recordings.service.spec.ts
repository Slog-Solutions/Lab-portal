import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RecordingKind, UserRole } from '@lab/shared';
import { ClassRecordingsService } from './class-recordings.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { StorageService } from '../../common/storage/storage.service';
import type { ClassAccessService } from '../classroom/class-access.service';

const TEACHER = { sub: 'teacher1', role: UserRole.TEACHER, serviceNumber: 'T1' };
const OTHER_TEACHER = { sub: 'teacher2', role: UserRole.TEACHER, serviceNumber: 'T2' };
const ADMIN = { sub: 'admin1', role: UserRole.ADMIN, serviceNumber: 'A1' };

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rec1',
    kind: RecordingKind.CLASS_BROADCAST,
    liveClassId: 'class1',
    createdById: 'teacher1',
    withAudio: true,
    status: 'recording' as const,
    path: 'recordings/class/rec1.webm',
    chunkCount: 0,
    sizeBytes: null as number | null,
    durationMs: null as number | null,
    createdAt: new Date(),
    updatedAt: new Date(),
    finalizedAt: null as Date | null,
    liveClass: { title: "Teacher's class" },
    createdBy: { fullName: 'Ms Teacher' },
    ...overrides,
  };
}

/** A mutable in-memory row plus a fake Prisma whose create/update mutate it —
 * enough for this service, which never reads more than one Recording row at
 * a time outside `list`. */
function makeFakePrisma(initial: ReturnType<typeof makeRow> | null) {
  let store = initial;
  const recording = {
    create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      store = makeRow({ ...data, id: 'rec1', chunkCount: 0 });
      return { ...store };
    }),
    update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      store = { ...(store as ReturnType<typeof makeRow>), ...data } as ReturnType<typeof makeRow>;
      return { ...store };
    }),
    findUnique: vi.fn().mockImplementation(() => (store ? { ...store } : null)),
    findMany: vi.fn().mockResolvedValue(store ? [store] : []),
    delete: vi.fn().mockImplementation(() => {
      store = null;
      return {};
    }),
  };
  return { recording, liveClass: { findFirst: vi.fn() } };
}

describe('ClassRecordingsService — create', () => {
  it('refuses a teacher with no active class, before writing anything', async () => {
    const prisma = makeFakePrisma(null);
    const classAccess = { activeClassForTeacher: vi.fn().mockResolvedValue(null) };
    const svc = new ClassRecordingsService(prisma as unknown as PrismaService, {} as StorageService, classAccess as unknown as ClassAccessService);

    await expect(svc.create(TEACHER, true)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.recording.create).not.toHaveBeenCalled();
  });

  it('scopes a teacher recording to their active class', async () => {
    const prisma = makeFakePrisma(null);
    const classAccess = { activeClassForTeacher: vi.fn().mockResolvedValue({ id: 'class1' }) };
    const svc = new ClassRecordingsService(prisma as unknown as PrismaService, {} as StorageService, classAccess as unknown as ClassAccessService);

    const result = await svc.create(TEACHER, false);

    expect(result).toEqual({ id: 'rec1' });
    expect(prisma.recording.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: RecordingKind.CLASS_BROADCAST,
        liveClassId: 'class1',
        createdById: 'teacher1',
        withAudio: false,
        status: 'recording',
      }),
    });
    expect(prisma.recording.update).toHaveBeenCalledWith({ where: { id: 'rec1' }, data: { path: 'recordings/class/rec1.webm' } });
  });

  it('never requires an active class for an admin, and records with no liveClassId', async () => {
    const prisma = makeFakePrisma(null);
    const classAccess = { activeClassForTeacher: vi.fn() };
    const svc = new ClassRecordingsService(prisma as unknown as PrismaService, {} as StorageService, classAccess as unknown as ClassAccessService);

    await svc.create(ADMIN, true);

    expect(classAccess.activeClassForTeacher).not.toHaveBeenCalled();
    expect(prisma.recording.create).toHaveBeenCalledWith({ data: expect.objectContaining({ liveClassId: null, createdById: 'admin1' }) });
  });
});

describe('ClassRecordingsService — appendChunk', () => {
  let tmpDir: string;
  let storage: StorageService;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'class-rec-'));
    storage = {
      resolve: (relativePath: string) => path.join(tmpDir, relativePath),
      removeTemp: async (p: string) => rmSync(p, { force: true }),
    } as unknown as StorageService;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeTempChunk(content: string): string {
    const tempPath = path.join(tmpDir, `upload-${Math.random().toString(36).slice(2)}.tmp`);
    writeFileSync(tempPath, content);
    return tempPath;
  }

  it('appends an in-order chunk and increments chunkCount', async () => {
    const prisma = makeFakePrisma(makeRow({ chunkCount: 0 }));
    const svc = new ClassRecordingsService(prisma as unknown as PrismaService, storage, {} as ClassAccessService);
    const chunk = writeTempChunk('hello ');

    const result = await svc.appendChunk('rec1', TEACHER, 0, chunk);

    expect(result).toEqual({ chunkCount: 1 });
    expect(readFileSync(path.join(tmpDir, 'recordings/class/rec1.webm'), 'utf8')).toBe('hello ');
    expect(prisma.recording.update).toHaveBeenCalledWith({ where: { id: 'rec1' }, data: { chunkCount: 1, sizeBytes: 6 } });
  });

  it('appends a second in-order chunk after the first, in order', async () => {
    const prisma = makeFakePrisma(makeRow({ chunkCount: 0 }));
    const svc = new ClassRecordingsService(prisma as unknown as PrismaService, storage, {} as ClassAccessService);

    await svc.appendChunk('rec1', TEACHER, 0, writeTempChunk('hello '));
    const result = await svc.appendChunk('rec1', TEACHER, 1, writeTempChunk('world'));

    expect(result).toEqual({ chunkCount: 2 });
    expect(readFileSync(path.join(tmpDir, 'recordings/class/rec1.webm'), 'utf8')).toBe('hello world');
  });

  it('treats a replayed (already-applied) seq as a no-op, not an error', async () => {
    const prisma = makeFakePrisma(makeRow({ chunkCount: 1 }));
    const svc = new ClassRecordingsService(prisma as unknown as PrismaService, storage, {} as ClassAccessService);
    prisma.recording.update.mockClear();

    const result = await svc.appendChunk('rec1', TEACHER, 0, writeTempChunk('should not land'));

    expect(result).toEqual({ chunkCount: 1, duplicate: true });
    expect(prisma.recording.update).not.toHaveBeenCalled();
  });

  it('rejects a chunk arriving ahead of the expected sequence with 409 + nextSeq', async () => {
    const prisma = makeFakePrisma(makeRow({ chunkCount: 1 }));
    const svc = new ClassRecordingsService(prisma as unknown as PrismaService, storage, {} as ClassAccessService);

    expect.assertions(2);
    try {
      await svc.appendChunk('rec1', TEACHER, 5, writeTempChunk('gap'));
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toEqual({ message: 'Chunk out of order', nextSeq: 1 });
    }
  });

  it('refuses another teacher\'s recording, and still cleans up the temp file', async () => {
    const prisma = makeFakePrisma(makeRow({ createdById: 'teacher1' }));
    const svc = new ClassRecordingsService(prisma as unknown as PrismaService, storage, {} as ClassAccessService);
    const chunk = writeTempChunk('x');

    await expect(svc.appendChunk('rec1', OTHER_TEACHER, 0, chunk)).rejects.toBeInstanceOf(ForbiddenException);
    // Regression: the 403 used to short-circuit before the temp file's own
    // removeTemp call, leaking it under LabData/tmp forever (caught live
    // against the real dev server, not by a mocked-Prisma test alone).
    expect(existsSync(chunk)).toBe(false);
  });

  it('lets an admin append to any teacher\'s recording', async () => {
    const prisma = makeFakePrisma(makeRow({ createdById: 'teacher1', chunkCount: 0 }));
    const svc = new ClassRecordingsService(prisma as unknown as PrismaService, storage, {} as ClassAccessService);

    await expect(svc.appendChunk('rec1', ADMIN, 0, writeTempChunk('x'))).resolves.toEqual({ chunkCount: 1 });
  });

  it('refuses a chunk once the recording is already finalized', async () => {
    const prisma = makeFakePrisma(makeRow({ status: 'ready', chunkCount: 3 }));
    const svc = new ClassRecordingsService(prisma as unknown as PrismaService, storage, {} as ClassAccessService);

    await expect(svc.appendChunk('rec1', TEACHER, 3, writeTempChunk('late'))).rejects.toBeInstanceOf(ConflictException);
  });

  it('serializes concurrent appends for the same id so bytes never interleave', async () => {
    const prisma = makeFakePrisma(makeRow({ chunkCount: 0 }));
    const svc = new ClassRecordingsService(prisma as unknown as PrismaService, storage, {} as ClassAccessService);

    await Promise.all([svc.appendChunk('rec1', TEACHER, 0, writeTempChunk('A')), svc.appendChunk('rec1', TEACHER, 1, writeTempChunk('B'))]);

    expect(readFileSync(path.join(tmpDir, 'recordings/class/rec1.webm'), 'utf8')).toBe('AB');
  });
});

describe('ClassRecordingsService — finish', () => {
  let tmpDir: string;
  let storage: StorageService;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'class-rec-finish-'));
    storage = { resolve: (relativePath: string) => path.join(tmpDir, relativePath), removeTemp: async () => undefined } as unknown as StorageService;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('marks a recording with real chunks ready', async () => {
    const prisma = makeFakePrisma(makeRow({ chunkCount: 2 }));
    const svc = new ClassRecordingsService(prisma as unknown as PrismaService, storage, {} as ClassAccessService);
    const absolute = path.join(tmpDir, 'recordings/class/rec1.webm');
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, 'AABB');

    const result = await svc.finish('rec1', TEACHER, 9000);

    expect(result.status).toBe('ready');
    expect(result.sizeBytes).toBe(4);
  });

  // Regression: a recording where every chunk upload failed (or the
  // recorder never produced one — the "stop() drops the tail chunk" bug
  // this fix closes) used to be marked 'ready' anyway, so a teacher only
  // discovered it was empty when playback failed later with no
  // explanation. It must read as 'failed' instead.
  it('marks a recording with zero chunks failed, not ready', async () => {
    const prisma = makeFakePrisma(makeRow({ chunkCount: 0 }));
    const svc = new ClassRecordingsService(prisma as unknown as PrismaService, storage, {} as ClassAccessService);

    const result = await svc.finish('rec1', TEACHER, 9000);

    expect(result.status).toBe('failed');
    expect(result.sizeBytes).toBeNull();
  });

  it('is idempotent — a second call returns the already-finished row unchanged', async () => {
    const prisma = makeFakePrisma(makeRow({ status: 'failed', chunkCount: 0, durationMs: 9000 }));
    const svc = new ClassRecordingsService(prisma as unknown as PrismaService, storage, {} as ClassAccessService);
    prisma.recording.update.mockClear();

    const result = await svc.finish('rec1', TEACHER, 99999);

    expect(result.durationMs).toBe(9000);
    expect(prisma.recording.update).not.toHaveBeenCalled();
  });
});

describe('ClassRecordingsService — list', () => {
  it('scopes a teacher to their own recordings', async () => {
    const prisma = makeFakePrisma(makeRow());
    const svc = new ClassRecordingsService(prisma as unknown as PrismaService, {} as StorageService, {} as ClassAccessService);

    await svc.list(TEACHER);

    expect(prisma.recording.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kind: RecordingKind.CLASS_BROADCAST, createdById: 'teacher1' } }),
    );
  });

  it('shows an admin every class recording, not just their own', async () => {
    const prisma = makeFakePrisma(makeRow());
    const svc = new ClassRecordingsService(prisma as unknown as PrismaService, {} as StorageService, {} as ClassAccessService);

    await svc.list(ADMIN);

    expect(prisma.recording.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { kind: RecordingKind.CLASS_BROADCAST } }));
  });

  it('reports a stale in-progress recording as incomplete', async () => {
    const staleUpdatedAt = new Date(Date.now() - 5 * 60 * 1000);
    const prisma = makeFakePrisma(makeRow({ status: 'recording', updatedAt: staleUpdatedAt }));
    const svc = new ClassRecordingsService(prisma as unknown as PrismaService, {} as StorageService, {} as ClassAccessService);

    const [view] = await svc.list(TEACHER);

    expect(view).toMatchObject({ status: 'incomplete' });
  });

  it('reports a fresh in-progress recording as still recording', async () => {
    const prisma = makeFakePrisma(makeRow({ status: 'recording', updatedAt: new Date() }));
    const svc = new ClassRecordingsService(prisma as unknown as PrismaService, {} as StorageService, {} as ClassAccessService);

    const [view] = await svc.list(TEACHER);

    expect(view).toMatchObject({ status: 'recording' });
  });
});

describe('ClassRecordingsService — remove', () => {
  it('refuses to delete another teacher\'s recording, and leaves it in place', async () => {
    const prisma = makeFakePrisma(makeRow({ createdById: 'teacher1' }));
    const svc = new ClassRecordingsService(prisma as unknown as PrismaService, {} as StorageService, {} as ClassAccessService);

    await expect(svc.remove('rec1', OTHER_TEACHER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.recording.delete).not.toHaveBeenCalled();
  });

  it('404s for an id that is not a class-broadcast recording at all', async () => {
    const prisma = makeFakePrisma(makeRow({ kind: RecordingKind.PRONUNCIATION }));
    const svc = new ClassRecordingsService(prisma as unknown as PrismaService, {} as StorageService, {} as ClassAccessService);

    await expect(svc.remove('rec1', TEACHER)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ClassRecordingsService — getFilePathForStudent', () => {
  const STUDENT = 'student1';
  const BATCH = 'batch1';
  const storage = { resolve: (p: string) => `/data/${p}` } as unknown as StorageService;

  function makePrismaForRead(overrides: { recording?: unknown; enrolled?: boolean } = {}) {
    const recording =
      overrides.recording !== undefined
        ? overrides.recording
        : { id: 'rec1', kind: RecordingKind.CLASS_BROADCAST, path: 'recordings/class/rec1.webm', liveClass: { batchId: BATCH } };
    return {
      recording: { findUnique: vi.fn().mockResolvedValue(recording) },
      enrollment: { findUnique: vi.fn().mockResolvedValue(overrides.enrolled === false ? null : { userId: STUDENT, batchId: BATCH }) },
    };
  }

  it("resolves the file for a student enrolled in the recording's class", async () => {
    const prisma = makePrismaForRead();
    const svc = new ClassRecordingsService(prisma as unknown as PrismaService, storage, {} as ClassAccessService);

    await expect(svc.getFilePathForStudent('rec1', STUDENT)).resolves.toBe('/data/recordings/class/rec1.webm');
    expect(prisma.enrollment.findUnique).toHaveBeenCalledWith({ where: { userId_batchId: { userId: STUDENT, batchId: BATCH } } });
  });

  it('refuses a student who is not enrolled in that class', async () => {
    const prisma = makePrismaForRead({ enrolled: false });
    const svc = new ClassRecordingsService(prisma as unknown as PrismaService, storage, {} as ClassAccessService);

    await expect(svc.getFilePathForStudent('rec1', STUDENT)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a recording from an ad-hoc class with no batch roster to check against', async () => {
    const prisma = makePrismaForRead({ recording: { id: 'rec1', kind: RecordingKind.CLASS_BROADCAST, path: 'x', liveClass: null } });
    const svc = new ClassRecordingsService(prisma as unknown as PrismaService, storage, {} as ClassAccessService);

    await expect(svc.getFilePathForStudent('rec1', STUDENT)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.enrollment.findUnique).not.toHaveBeenCalled();
  });

  it('404s for an id that is not a class-broadcast recording', async () => {
    const prisma = makePrismaForRead({ recording: null });
    const svc = new ClassRecordingsService(prisma as unknown as PrismaService, storage, {} as ClassAccessService);

    await expect(svc.getFilePathForStudent('rec1', STUDENT)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s when the recording has no file yet', async () => {
    const prisma = makePrismaForRead({ recording: { id: 'rec1', kind: RecordingKind.CLASS_BROADCAST, path: null, liveClass: { batchId: BATCH } } });
    const svc = new ClassRecordingsService(prisma as unknown as PrismaService, storage, {} as ClassAccessService);

    await expect(svc.getFilePathForStudent('rec1', STUDENT)).rejects.toBeInstanceOf(NotFoundException);
  });
});
