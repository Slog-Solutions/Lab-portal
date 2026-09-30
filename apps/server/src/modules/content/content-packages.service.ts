import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import AdmZip from 'adm-zip';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { ContentPackageFormat, MediaAssetScope, UserRole, type ImportContentPackageDto } from '@lab/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { parseScormManifest } from './scorm-manifest';

export interface UploadedPackageFile {
  tempPath: string;
  originalName: string;
}

/**
 * SCORM/xAPI/HTML import (build plan "we build the engine, a SCORM/xAPI
 * import path, and an original CEFR seed pack" — Annexure-I names
 * third-party products, e.g. Britannica, that this project does not and
 * cannot ship; see docs/compliance-matrix.md).
 *
 * Scope: this resolves and serves a launchable package. It does not
 * implement a server-side SCORM RTE data model (LMSGetValue/SetValue) —
 * that shim lives client-side in ContentExercisePlayer, which is where a
 * package's own JS calls it via the standard SCORM findAPI() convention.
 * xAPI statement capture (a real LRS) is out of scope for the same
 * reason a full SCORM RTE is: this is a courseware *launcher*, not a
 * learning-record-store implementation — xAPI/HTML packages import and
 * serve identically to SCORM, minus the manifest-driven entry-point
 * resolution, and their score comes from the exercise's own scorer or a
 * teacher's ScoreOverride, not an intercepted xAPI statement stream.
 */
@Injectable()
export class ContentPackagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async import(ownerId: string, dto: ImportContentPackageDto, upload: UploadedPackageFile) {
    const isZip = upload.originalName.toLowerCase().endsWith('.zip');
    await mkdir(this.storage.tempDir(), { recursive: true });
    const extractDir = await mkdtemp(path.join(this.storage.tempDir(), 'pkg-'));

    try {
      let entryPoint: string;
      let resolvedFormat = dto.format;

      if (isZip) {
        await this.extractZipSafely(upload.tempPath, extractDir);
        const resolved = await this.resolveEntryPoint(dto.format, extractDir);
        entryPoint = resolved.entryPoint;
        resolvedFormat = resolved.format ?? dto.format;
      } else {
        // A single loose file (typically format: HTML) — no zip needed
        // for the simple one-page case; keep the original filename since
        // nothing else references it by a generated id.
        const destName = path.basename(upload.originalName);
        await rename(upload.tempPath, path.join(extractDir, destName));
        entryPoint = destName;
      }
      const sizeBytes = await dirSize(extractDir);

      const contentPackage = await this.prisma.contentPackage.create({
        data: {
          ownerId,
          scope: dto.scope,
          title: dto.title,
          publisher: dto.publisher,
          gradeLevel: dto.gradeLevel,
          cefrLevel: dto.cefrLevel,
          description: dto.description,
          format: resolvedFormat,
          entryPoint,
          path: '', // filled in once the directory is committed (needs the id)
          sizeBytes,
        },
      });

      const { relativePath } = await this.storage.commitDir(extractDir, 'content', contentPackage.id);
      const updated = await this.prisma.contentPackage.update({
        where: { id: contentPackage.id },
        data: { path: relativePath },
      });

      await this.audit.log({
        actorId: ownerId,
        action: 'content_package.import',
        detail: { packageId: contentPackage.id, format: resolvedFormat, entryPoint },
      });
      return updated;
    } catch (err) {
      await this.storage.removeTemp(extractDir);
      throw err;
    }
  }

  async list(requester: { id: string; role: string }) {
    if (requester.role === UserRole.ADMIN) {
      return this.prisma.contentPackage.findMany({ orderBy: { importedAt: 'desc' } });
    }
    return this.prisma.contentPackage.findMany({
      where: { OR: [{ ownerId: requester.id }, { scope: { in: [MediaAssetScope.DEPARTMENT, MediaAssetScope.INSTITUTION] } }] },
      orderBy: { importedAt: 'desc' },
    });
  }

  async get(id: string, requester: { id: string; role: string }) {
    const pkg = await this.prisma.contentPackage.findUnique({ where: { id } });
    if (!pkg) throw new NotFoundException('Content package not found');
    if (requester.role !== UserRole.ADMIN && pkg.scope === MediaAssetScope.PRIVATE && pkg.ownerId !== requester.id) {
      throw new ForbiddenException('This content package is private to its owner');
    }
    return pkg;
  }

  /** Anyone who can reach the launch route (i.e. a student running the
   * exercise) needs to fetch the package's own files unauthenticated by
   * role — access control for *launching* happens at the Exercise/Attempt
   * layer, not here; this only resolves + path-guards the file. */
  async getForLaunch(id: string) {
    const pkg = await this.prisma.contentPackage.findUnique({ where: { id } });
    if (!pkg) throw new NotFoundException('Content package not found');
    return pkg;
  }

  /** Resolves a package-relative file path, guarding against traversal
   * (the same idiom as apps/desktop/src/main/protocol.ts's app:// handler).
   * `relativeFilePath` arrives already-decoded — Express decodes each
   * wildcard path segment itself before this is called. */
  resolveAssetPath(pkg: { path: string }, relativeFilePath: string): string {
    const root = this.storage.resolve(pkg.path);
    const requested = path.join(root, relativeFilePath);
    if (!requested.startsWith(root)) {
      throw new ForbiddenException('Path escapes the content package root');
    }
    return requested;
  }

  async remove(id: string, requester: { id: string; role: string }): Promise<void> {
    const pkg = await this.get(id, requester);
    if (pkg.builtinKey) throw new ForbiddenException('Ready-made content ships with the lab and cannot be deleted');
    if (requester.role !== UserRole.ADMIN && pkg.ownerId !== requester.id) {
      throw new ForbiddenException('Only the owner or an admin may delete this content package');
    }
    await this.prisma.contentPackage.delete({ where: { id } });
    await rm(this.storage.resolve(pkg.path), { recursive: true, force: true });
    await this.audit.log({ actorId: requester.id, action: 'content_package.delete', detail: { packageId: id } });
  }

  /** Rejects zip-slip entries defensively before extraction, even though
   * adm-zip 0.6+ already normalizes paths on extractAllTo — belt and
   * braces for something that writes to disk from an uploaded archive. */
  private async extractZipSafely(zipPath: string, destDir: string): Promise<void> {
    const zip = new AdmZip(zipPath);
    for (const entry of zip.getEntries()) {
      const name = entry.entryName.replace(/\\/g, '/');
      if (name.startsWith('/') || name.split('/').includes('..')) {
        throw new BadRequestException(`Refusing to extract unsafe zip entry: ${entry.entryName}`);
      }
    }
    await mkdir(destDir, { recursive: true });
    zip.extractAllTo(destDir, true);
  }

  private async resolveEntryPoint(
    declaredFormat: ImportContentPackageDto['format'],
    extractDir: string,
  ): Promise<{ entryPoint: string; format?: ImportContentPackageDto['format'] }> {
    if (declaredFormat === ContentPackageFormat.SCORM12 || declaredFormat === ContentPackageFormat.SCORM2004) {
      const manifestPath = path.join(extractDir, 'imsmanifest.xml');
      if (!existsSync(manifestPath)) {
        throw new BadRequestException('SCORM package is missing imsmanifest.xml at its root');
      }
      const xml = await readFile(manifestPath, 'utf-8');
      try {
        const parsed = parseScormManifest(xml);
        return { entryPoint: parsed.entryPoint, format: parsed.format };
      } catch (err) {
        throw new BadRequestException(`Could not parse imsmanifest.xml: ${(err as Error).message}`);
      }
    }

    // XAPI/HTML: index.html at the root, else the first .html file found
    // anywhere in the package (deterministic — sorted by relative path).
    const indexAtRoot = path.join(extractDir, 'index.html');
    if (existsSync(indexAtRoot)) return { entryPoint: 'index.html' };

    const found = await findFirstHtml(extractDir, extractDir);
    if (!found) {
      throw new BadRequestException('Could not find index.html (or any .html file) in the uploaded package');
    }
    return { entryPoint: found };
  }
}

async function findFirstHtml(dir: string, root: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true });
  const htmlFiles: string[] = [];
  const subdirs: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) subdirs.push(path.join(dir, entry.name));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
      htmlFiles.push(path.relative(root, path.join(dir, entry.name)).split(path.sep).join('/'));
    }
  }
  if (htmlFiles.length > 0) return htmlFiles.sort()[0]!;
  for (const subdir of subdirs.sort()) {
    const found = await findFirstHtml(subdir, root);
    if (found) return found;
  }
  return null;
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else if (entry.isFile()) total += (await stat(full)).size;
  }
  return total;
}
