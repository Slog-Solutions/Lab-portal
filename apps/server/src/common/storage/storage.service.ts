import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { EnvConfig } from '../../config/env.validation';

/**
 * One LAB_DATA_ROOT convention for every Phase 3 module (media assets,
 * content packages, recordings) — the design doc's own MediaAsset.path
 * comment ("relative to LabData root") vs. RecordingsService's original
 * CWD-joined absolute-ish path had already drifted into two conventions;
 * this is the single implementation from here on.
 *
 * Every stored `path` column is relative to the root, never absolute —
 * makes the whole LabData tree portable (back up the folder, move the
 * drive letter, restore on new hardware) without touching the database.
 *
 * Temp uploads land under `<root>/tmp`, not os.tmpdir(): multer's
 * destination and the final commit() must be the same filesystem volume,
 * or Node's fs.rename throws EXDEV. os.tmpdir() is typically C: on a
 * Windows install; LAB_DATA_ROOT is meant to become D:\LabData in the
 * real deployment (build plan "Storage" row) — cross-volume was a live
 * risk the moment any upload path got copied from RecordingsService's
 * original os.tmpdir()-based one, which predates this module.
 */
@Injectable()
export class StorageService {
  readonly root: string;

  constructor(config: ConfigService<EnvConfig, true>) {
    this.root = path.resolve(config.get('LAB_DATA_ROOT', { infer: true }));
  }

  tempDir(): string {
    return path.join(this.root, 'tmp');
  }

  async ensureTempDir(): Promise<string> {
    const dir = this.tempDir();
    await mkdir(dir, { recursive: true });
    return dir;
  }

  /** Absolute path for a stored-relative path (e.g. reading a file back). */
  resolve(relativePath: string): string {
    return path.join(this.root, relativePath);
  }

  /** Moves a temp upload into permanent storage under `<root>/<subdir>/`,
   * naming it `<id><ext>`. Returns the path to persist in the DB
   * (relative to root) plus the final size on disk. */
  async commitFile(
    tempPath: string,
    subdir: string,
    id: string,
    ext: string,
  ): Promise<{ relativePath: string; sizeBytes: number }> {
    const relativePath = path.posix.join(subdir, `${id}${ext}`);
    const destAbsolute = path.join(this.root, subdir, `${id}${ext}`);
    await mkdir(path.dirname(destAbsolute), { recursive: true });
    await rename(tempPath, destAbsolute);
    const { size } = await stat(destAbsolute);
    return { relativePath, sizeBytes: size };
  }

  /** Recursively commits an already-extracted directory tree (SCORM
   * import) into permanent storage under `<root>/<subdir>/<id>/`. */
  async commitDir(tempDirPath: string, subdir: string, id: string): Promise<{ relativePath: string }> {
    const relativePath = path.posix.join(subdir, id);
    const destAbsolute = path.join(this.root, subdir, id);
    await mkdir(path.dirname(destAbsolute), { recursive: true });
    await rename(tempDirPath, destAbsolute);
    return { relativePath };
  }

  async removeTemp(tempPath: string): Promise<void> {
    await rm(tempPath, { recursive: true, force: true });
  }
}
