import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import path from 'node:path';
import { MediaAssetScope, UserRole, type UploadMediaAssetDto, type UpdateMediaAssetDto } from '@lab/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { AuditService } from '../audit/audit.service';

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
 */
@Injectable()
export class MediaAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async create(ownerId: string, dto: UploadMediaAssetDto, upload: CommittedUpload) {
    const ext = path.extname(upload.originalName) || '';
    const asset = await this.prisma.mediaAsset.create({
      data: {
        ownerId,
        scope: dto.scope,
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
    return this.prisma.mediaAsset.update({ where: { id }, data: dto });
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
