import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import path from 'node:path';
import { MediaAssetScope, UserRole, type UploadMediaAssetDto, type UpdateMediaAssetDto } from '@lab/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { BatchAccessService } from '../batches/batch-access.service';

export interface CommittedUpload {
  tempPath: string;
  originalName: string;
  mimeType: string;
}

/**
 * The media library (Ser 1 "media library... multi-teacher access
 * facility for sharing and collaborating content resources"). Reuses the
 * Phase 2 recording pipeline's core idea (create-before-commit isn't
 * needed here since upload is synchronous multipart, not a live
 * MediaRecorder stream) but the StorageService convention is shared with
 * both recordings and content packages.
 *
 * Visibility (no Department entity exists anywhere in the schema, so
 * DEPARTMENT and INSTITUTION share one rule here: visible lab-wide.
 * PRIVATE is owner-only. ADMIN bypasses scope entirely.):
 *   - PRIVATE:            owner only
 *   - DEPARTMENT/INSTITUTION: every TEACHER/ADMIN
 *
 * Student audience is a separate axis from the above (which is about who can
 * see the file in the teachers' library): `studentVisible` puts it in students'
 * Study Material, and `sharedBatchIds` narrows that to the students of those
 * classes (empty = all students). A teacher may name only classes they teach.
 */
@Injectable()
export class MediaAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly batchAccess: BatchAccessService,
  ) {}

  async create(requester: { id: string; role: string }, dto: UploadMediaAssetDto, upload: CommittedUpload) {
    const ownerId = requester.id;
    const studentVisible = dto.studentVisible ?? false;
    const sharedBatchIds = dto.sharedBatchIds ?? [];
    this.assertStudentVisibleAllowed(dto.scope, studentVisible);
    await this.assertClassesShareable(sharedBatchIds, requester);
    const ext = path.extname(upload.originalName) || '';
    const asset = await this.prisma.mediaAsset.create({
      data: {
        ownerId,
        scope: dto.scope,
        studentVisible,
        sharedBatchIds,
        kind: dto.kind,
        title: dto.title,
        filename: upload.originalName,
        path: '', // placeholder until committed below (id needed for the filename)
        sizeBytes: 0,
        mimeType: upload.mimeType,
      },
    });
    const { relativePath, sizeBytes } = await this.storage.commitFile(upload.tempPath, 'media', asset.id, ext);
    const updated = await this.prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { path: relativePath, sizeBytes },
    });
    await this.audit.log({ actorId: ownerId, action: 'media_asset.upload', detail: { assetId: asset.id, kind: dto.kind } });
    return updated;
  }

  async list(requester: { id: string; role: string }) {
    if (requester.role === UserRole.ADMIN) {
      return this.prisma.mediaAsset.findMany({ orderBy: { createdAt: 'desc' } });
    }
    return this.prisma.mediaAsset.findMany({
      where: { OR: [{ ownerId: requester.id }, { scope: { in: [MediaAssetScope.DEPARTMENT, MediaAssetScope.INSTITUTION] } }] },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string, requester: { id: string; role: string }) {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('Media asset not found');
    this.assertReadable(asset, requester);
    return asset;
  }

  async update(id: string, dto: UpdateMediaAssetDto, requester: { id: string; role: string }) {
    const asset = await this.get(id, requester);
    this.assertOwnerOrAdmin(asset, requester);
    // Only classes being added are checked: an admin may have shared the file
    // with a class this teacher doesn't teach, and saving an unrelated edit
    // must not bounce because that class is still on the list.
    if (dto.sharedBatchIds) {
      await this.assertClassesShareable(
        dto.sharedBatchIds.filter((id) => !asset.sharedBatchIds.includes(id)),
        requester,
      );
    }
    // Hiding is the safe direction: making a file PRIVATE without saying
    // anything about students just takes it off their list, instead of
    // bouncing the teacher with an error about a flag they never touched.
    const studentVisible = dto.studentVisible ?? (dto.scope === MediaAssetScope.PRIVATE ? false : asset.studentVisible);
    this.assertStudentVisibleAllowed(dto.scope ?? asset.scope, studentVisible);
    return this.prisma.mediaAsset.update({ where: { id }, data: { ...dto, studentVisible } });
  }

  async remove(id: string, requester: { id: string; role: string }): Promise<void> {
    const asset = await this.get(id, requester);
    this.assertOwnerOrAdmin(asset, requester);
    await this.prisma.mediaAsset.delete({ where: { id } });
    await this.audit.log({ actorId: requester.id, action: 'media_asset.delete', detail: { assetId: id } });
    // Deliberately not deleting the file from disk here: an Item still
    // holding mediaAssetId (SET NULL on delete) may reference historical
    // attempts that expect the audio to keep existing for review. Orphan
    // sweep is a hardening item (Phase 5), not required for the library
    // to function correctly today.
  }

  resolveFilePath(asset: { path: string }): string {
    return this.storage.resolve(asset.path);
  }

  /** A student seat reads files with its station token, which is never the
   * owner of a PRIVATE asset (see assertReadable) — so a private file can't be
   * offered to students. */
  private assertStudentVisibleAllowed(scope: string, studentVisible: boolean): void {
    if (studentVisible && scope === MediaAssetScope.PRIVATE) {
      throw new BadRequestException('A private file cannot be shown to students — share it with the department or institution first');
    }
  }

  /** A teacher may aim a file only at classes they are assigned to (the same
   * rule as running a session); an admin at any class that exists. */
  private async assertClassesShareable(batchIds: string[], requester: { id: string; role: string }): Promise<void> {
    if (batchIds.length === 0) return;
    if (requester.role === UserRole.ADMIN) {
      const known = await this.prisma.batch.count({ where: { id: { in: batchIds } } });
      if (known !== batchIds.length) throw new BadRequestException('One or more of those classes no longer exist');
      return;
    }
    const taught = new Set(await this.batchAccess.batchIdsForTeacher(requester.id));
    if (batchIds.some((id) => !taught.has(id))) {
      throw new ForbiddenException('You can only share a file with classes you teach');
    }
  }

  private assertReadable(asset: { ownerId: string; scope: string }, requester: { id: string; role: string }): void {
    if (requester.role === UserRole.ADMIN) return;
    if (asset.scope !== MediaAssetScope.PRIVATE) return;
    if (asset.ownerId === requester.id) return;
    throw new ForbiddenException('This media asset is private to its owner');
  }

  private assertOwnerOrAdmin(asset: { ownerId: string }, requester: { id: string; role: string }): void {
    if (requester.role === UserRole.ADMIN || asset.ownerId === requester.id) return;
    throw new ForbiddenException('Only the owner or an admin may modify this media asset');
  }
}
