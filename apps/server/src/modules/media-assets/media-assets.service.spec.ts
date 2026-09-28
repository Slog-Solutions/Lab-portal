import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AssetKind, MediaAssetScope, UserRole, zUploadMediaAssetDto } from '@lab/shared';
import { MediaAssetsService } from './media-assets.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { StorageService } from '../../common/storage/storage.service';
import type { AuditService } from '../audit/audit.service';
import type { BatchAccessService } from '../batches/batch-access.service';

const OWNER = { id: 'teacher1', role: UserRole.TEACHER };
const ADMIN = { id: 'admin1', role: UserRole.ADMIN };
const CLASS_A = 'clh3am1r30000qzrmn831i7a';
const CLASS_B = 'clh3am1r30000qzrmn831i7b';
const UPLOAD = { tempPath: '/tmp/x', originalName: 'notes.md', mimeType: 'text/markdown' };

function stored(over: Record<string, unknown> = {}) {
  return { id: 'a1', ownerId: OWNER.id, scope: MediaAssetScope.INSTITUTION, studentVisible: false, sharedBatchIds: [] as string[], ...over };
}

function makeSvc(existing = stored(), taughtBatchIds: string[] = [CLASS_A]) {
  const prisma = {
    batch: { count: vi.fn().mockImplementation(({ where }) => (where.id.in as string[]).filter((id) => id === CLASS_A || id === CLASS_B).length) },
    mediaAsset: {
      create: vi.fn().mockImplementation(({ data }) => ({ id: 'a1', ...data })),
      update: vi.fn().mockImplementation(({ data }) => ({ ...existing, ...data })),
      findUnique: vi.fn().mockResolvedValue(existing),
    },
  };
  const storage = { commitFile: vi.fn().mockResolvedValue({ relativePath: 'media/a1.md', sizeBytes: 10 }) };
  const audit = { log: vi.fn() };
  const batchAccess = { batchIdsForTeacher: vi.fn().mockResolvedValue(taughtBatchIds) };
  const svc = new MediaAssetsService(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
    audit as unknown as AuditService,
    batchAccess as unknown as BatchAccessService,
  );
  return { svc, prisma };
}

describe('MediaAssetsService — student visibility', () => {
  it('a new upload is hidden from students unless the teacher opts in', async () => {
    const { svc, prisma } = makeSvc();
    await svc.create(OWNER, { kind: AssetKind.TEXT, scope: MediaAssetScope.INSTITUTION }, UPLOAD);
    expect(prisma.mediaAsset.create).toHaveBeenCalledWith({ data: expect.objectContaining({ studentVisible: false }) });
  });

  it('stores studentVisible when the teacher opts in', async () => {
    const { svc, prisma } = makeSvc();
    await svc.create(OWNER, { kind: AssetKind.TEXT, scope: MediaAssetScope.INSTITUTION, studentVisible: true }, UPLOAD);
    expect(prisma.mediaAsset.create).toHaveBeenCalledWith({ data: expect.objectContaining({ studentVisible: true }) });
  });

  it('refuses to show a PRIVATE upload to students, before anything is written', async () => {
    const { svc, prisma } = makeSvc();
    await expect(
      svc.create(OWNER, { kind: AssetKind.TEXT, scope: MediaAssetScope.PRIVATE, studentVisible: true }, UPLOAD),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.mediaAsset.create).not.toHaveBeenCalled();
  });

  it('update can switch visibility on for a shared file', async () => {
    const { svc, prisma } = makeSvc();
    await svc.update('a1', { studentVisible: true }, OWNER);
    expect(prisma.mediaAsset.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { studentVisible: true } });
  });

  it('update refuses visibility on a file that is already PRIVATE', async () => {
    const { svc, prisma } = makeSvc(stored({ scope: MediaAssetScope.PRIVATE }));
    await expect(svc.update('a1', { studentVisible: true }, OWNER)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.mediaAsset.update).not.toHaveBeenCalled();
  });

  it('update refuses to make a file PRIVATE and student-visible in one request', async () => {
    const { svc } = makeSvc();
    await expect(svc.update('a1', { scope: MediaAssetScope.PRIVATE, studentVisible: true }, OWNER)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('making a visible file PRIVATE quietly takes it off the students’ list', async () => {
    const { svc, prisma } = makeSvc(stored({ studentVisible: true }));
    await svc.update('a1', { scope: MediaAssetScope.PRIVATE }, OWNER);
    expect(prisma.mediaAsset.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { scope: MediaAssetScope.PRIVATE, studentVisible: false } });
  });

  it('a rename leaves the current visibility alone', async () => {
    const { svc, prisma } = makeSvc(stored({ studentVisible: true }));
    await svc.update('a1', { title: 'New name' }, OWNER);
    expect(prisma.mediaAsset.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { title: 'New name', studentVisible: true } });
  });
});

describe('MediaAssetsService — sharing with classes', () => {
  const visibleUpload = { kind: AssetKind.TEXT, scope: MediaAssetScope.INSTITUTION, studentVisible: true };

  it('a new upload names no classes by default, meaning all students', async () => {
    const { svc, prisma } = makeSvc();
    await svc.create(OWNER, visibleUpload, UPLOAD);
    expect(prisma.mediaAsset.create).toHaveBeenCalledWith({ data: expect.objectContaining({ sharedBatchIds: [] }) });
  });

  it('stores the classes a teacher picked from those they teach', async () => {
    const { svc, prisma } = makeSvc();
    await svc.create(OWNER, { ...visibleUpload, sharedBatchIds: [CLASS_A] }, UPLOAD);
    expect(prisma.mediaAsset.create).toHaveBeenCalledWith({ data: expect.objectContaining({ sharedBatchIds: [CLASS_A] }) });
  });

  it('refuses a class the teacher is not assigned to, before anything is written', async () => {
    const { svc, prisma } = makeSvc();
    await expect(svc.create(OWNER, { ...visibleUpload, sharedBatchIds: [CLASS_A, CLASS_B] }, UPLOAD)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.mediaAsset.create).not.toHaveBeenCalled();
  });

  it('lets an admin pick any class that exists, and refuses one that does not', async () => {
    const { svc, prisma } = makeSvc();
    await svc.create(ADMIN, { ...visibleUpload, sharedBatchIds: [CLASS_B] }, UPLOAD);
    expect(prisma.mediaAsset.create).toHaveBeenCalledWith({ data: expect.objectContaining({ sharedBatchIds: [CLASS_B] }) });

    prisma.mediaAsset.create.mockClear();
    await expect(svc.create(ADMIN, { ...visibleUpload, sharedBatchIds: ['clh3am1r30000qzrmn831i7z'] }, UPLOAD)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.mediaAsset.create).not.toHaveBeenCalled();
  });

  it('update changes the classes, checking the teacher teaches each one', async () => {
    const { svc, prisma } = makeSvc(stored({ studentVisible: true }));
    await svc.update('a1', { sharedBatchIds: [CLASS_A] }, OWNER);
    expect(prisma.mediaAsset.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { sharedBatchIds: [CLASS_A], studentVisible: true } });

    prisma.mediaAsset.update.mockClear();
    await expect(svc.update('a1', { sharedBatchIds: [CLASS_B] }, OWNER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.mediaAsset.update).not.toHaveBeenCalled();
  });

  it('update only checks classes being added, so a class an admin added does not block an edit', async () => {
    const { svc, prisma } = makeSvc(stored({ studentVisible: true, sharedBatchIds: [CLASS_B] }));
    await svc.update('a1', { sharedBatchIds: [CLASS_B, CLASS_A] }, OWNER);
    expect(prisma.mediaAsset.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { sharedBatchIds: [CLASS_B, CLASS_A], studentVisible: true } });
  });

  it('a rename leaves the classes alone', async () => {
    const { svc, prisma } = makeSvc(stored({ studentVisible: true, sharedBatchIds: [CLASS_A] }));
    await svc.update('a1', { title: 'New name' }, OWNER);
    expect(prisma.mediaAsset.update).toHaveBeenCalledWith({ where: { id: 'a1' }, data: { title: 'New name', studentVisible: true } });
  });
});

describe('zUploadMediaAssetDto sharedBatchIds', () => {
  const base = { kind: 'text', scope: 'INSTITUTION' };

  it('reads the multipart comma-separated string, and de-duplicates', () => {
    expect(zUploadMediaAssetDto.parse({ ...base, sharedBatchIds: `${CLASS_A},${CLASS_B},${CLASS_A}` }).sharedBatchIds).toEqual([CLASS_A, CLASS_B]);
  });

  it('accepts a real array (JSON body) and is optional', () => {
    expect(zUploadMediaAssetDto.parse({ ...base, sharedBatchIds: [CLASS_A] }).sharedBatchIds).toEqual([CLASS_A]);
    expect(zUploadMediaAssetDto.parse(base).sharedBatchIds).toBeUndefined();
  });

  it('rejects something that is not an id', () => {
    expect(() => zUploadMediaAssetDto.parse({ ...base, sharedBatchIds: 'not an id!' })).toThrow();
  });
});

describe('zUploadMediaAssetDto studentVisible', () => {
  const base = { kind: 'text', scope: 'INSTITUTION' };

  it('reads the multipart string "false" as false, not truthy', () => {
    expect(zUploadMediaAssetDto.parse({ ...base, studentVisible: 'false' }).studentVisible).toBe(false);
    expect(zUploadMediaAssetDto.parse({ ...base, studentVisible: 'true' }).studentVisible).toBe(true);
  });

  it('is optional and rejects other strings', () => {
    expect(zUploadMediaAssetDto.parse(base).studentVisible).toBeUndefined();
    expect(() => zUploadMediaAssetDto.parse({ ...base, studentVisible: 'yes' })).toThrow();
  });
});
