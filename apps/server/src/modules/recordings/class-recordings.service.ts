import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { RecordingKind, UserRole, type ClassRecordingView } from '@lab/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { ClassAccessService } from '../classroom/class-access.service';
import type { JwtPayload } from '../auth/auth.service';
import { deriveClassRecordingStatus } from './class-recording-status';

const SUBDIR = path.posix.join('recordings', 'class');

/**
 * Client-side recording of the teacher's own class broadcast (see
 * BroadcastPanel's Record button) — the same "capture in the browser,
 * upload the bytes" design as every other Recording (RecordingsService),
 * but teacher/admin-authenticated instead of station-authenticated, and
 * streamed in chunks instead of one blob: a 1-2h class recording would
 * otherwise sit entirely in renderer memory and can exceed MAX_UPLOAD_MB.
 *
 * Chunk appends are serialized per recording id (chunkQueues) so a
 * retried upload can never interleave bytes with the request it was
 * retrying — multer already wrote each chunk to its own temp file, so all
 * this does is order the appends.
 */
@Injectable()
export class ClassRecordingsService {
  private readonly chunkQueues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly classAccess: ClassAccessService,
  ) {}

  async create(user: JwtPayload, withAudio: boolean): Promise<{ id: string }> {
    let liveClassId: string | null = null;
    if (user.role !== UserRole.ADMIN) {
      const activeClass = await this.classAccess.activeClassForTeacher(user.sub);
      if (!activeClass) throw new ConflictException('Start a class before recording');
      liveClassId = activeClass.id;
    }

    const row = await this.prisma.recording.create({
      data: {
        kind: RecordingKind.CLASS_BROADCAST,
        liveClassId,
        createdById: user.sub,
        withAudio,
        status: 'recording',
      },
    });
    const relativePath = path.posix.join(SUBDIR, `${row.id}.webm`);
    await this.prisma.recording.update({ where: { id: row.id }, data: { path: relativePath } });
    return { id: row.id };
  }

  /** Loads a CLASS_BROADCAST row and checks the caller owns it (or is
   * ADMIN) — a teacher must never read, extend or delete another
   * teacher's class recording. Deliberately 404s (not 403) for a wrong
   * kind, so a station-recording id doesn't leak into this namespace. */
  private async getOwned(id: string, user: JwtPayload) {
    const recording = await this.prisma.recording.findUnique({ where: { id } });
    if (!recording || recording.kind !== RecordingKind.CLASS_BROADCAST) {
      throw new NotFoundException('Recording not found');
    }
    if (user.role !== UserRole.ADMIN && recording.createdById !== user.sub) {
      throw new ForbiddenException('Not your recording');
    }
    return recording;
  }

  /** Runs `task` after any append already queued for this id — see class
   * doc comment. A prior failure is swallowed (not re-thrown) here so one
   * bad chunk doesn't wedge every later one behind a rejected promise. */
  private async enqueue<T>(id: string, task: () => Promise<T>): Promise<T> {
    const prior = this.chunkQueues.get(id) ?? Promise.resolve();
    const settled = prior.catch(() => undefined).then(task);
    this.chunkQueues.set(id, settled);
    try {
      return await settled;
    } finally {
      if (this.chunkQueues.get(id) === settled) this.chunkQueues.delete(id);
    }
  }

  async appendChunk(
    id: string,
    user: JwtPayload,
    seq: number,
    tempPath: string,
  ): Promise<{ chunkCount: number; duplicate?: true }> {
    return this.enqueue(id, async () => {
      // Every path below ends the temp file's life one way or another
      // (appended into the recording, or simply not needed) — a `finally`
      // rather than repeating removeTemp per branch, so a rejection this
      // method didn't anticipate (getOwned's 403/404) can't leak it on
      // disk the way an per-branch call would.
      try {
        const recording = await this.getOwned(id, user);
        if (recording.status === 'ready') {
          throw new ConflictException('Recording already finalized');
        }
        if (seq < recording.chunkCount) {
          // Already applied (an upload retry whose earlier response never
          // reached the client) — a no-op, not an error.
          return { chunkCount: recording.chunkCount, duplicate: true as const };
        }
        if (seq > recording.chunkCount) {
          throw new ConflictException({ message: 'Chunk out of order', nextSeq: recording.chunkCount });
        }

        const absolute = this.storage.resolve(recording.path!);
        await mkdir(path.dirname(absolute), { recursive: true });
        await pipeline(createReadStream(tempPath), createWriteStream(absolute, { flags: 'a' }));
        const { size } = await stat(absolute);
        const chunkCount = recording.chunkCount + 1;
        await this.prisma.recording.update({
          where: { id },
          data: { chunkCount, sizeBytes: size },
        });
        return { chunkCount };
      } finally {
        await this.storage.removeTemp(tempPath);
      }
    });
  }

  async finish(id: string, user: JwtPayload, durationMs: number) {
    // Idempotent, and waits for any chunk append already in flight for
    // this id so a late chunk can't land after the row is marked ready
    // (ClassRecorder.stop drains its own queue first, but a slow retry
    // the client already gave up waiting on could still be in-process).
    const pending = this.chunkQueues.get(id);
    if (pending) await pending.catch(() => undefined);

    const recording = await this.getOwned(id, user);
    if (recording.status === 'ready' || recording.status === 'failed') return recording;

    let sizeBytes = recording.sizeBytes;
    if (recording.path) {
      try {
        sizeBytes = (await stat(this.storage.resolve(recording.path))).size;
      } catch {
        // No bytes ever landed — leave as-is (chunkCount === 0 below
        // catches this case and marks the row 'failed', not 'ready').
      }
    }
    // A recording with zero chunks (every upload failed, or the browser
    // never produced one — e.g. a backgrounded tab throttling capture)
    // must never present as 'ready': there is nothing to play back, and
    // silently calling it "Ready" is what made the previous bug (a lost
    // final chunk) invisible until playback failed later. See
    // ClassRecordingsPage's status badge for how 'failed' reads to the teacher.
    const status = recording.chunkCount > 0 ? 'ready' : 'failed';
    return this.prisma.recording.update({
      where: { id },
      data: { status, durationMs, sizeBytes, finalizedAt: new Date() },
    });
  }

  async list(user: JwtPayload): Promise<ClassRecordingView[]> {
    const rows = await this.prisma.recording.findMany({
      where: {
        kind: RecordingKind.CLASS_BROADCAST,
        ...(user.role === UserRole.ADMIN ? {} : { createdById: user.sub }),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        liveClass: { select: { title: true } },
        createdBy: { select: { fullName: true } },
      },
    });

    const now = Date.now();
    return rows.map((row) => ({
      id: row.id,
      liveClassId: row.liveClassId,
      classTitle: row.liveClass?.title ?? null,
      teacherName: row.createdBy?.fullName ?? 'Unknown',
      withAudio: row.withAudio ?? false,
      status: deriveClassRecordingStatus(row, now) as ClassRecordingView['status'],
      durationMs: row.durationMs,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt.toISOString(),
      finalizedAt: row.finalizedAt?.toISOString() ?? null,
    }));
  }

  async getFilePath(id: string, user: JwtPayload): Promise<string> {
    const recording = await this.getOwned(id, user);
    if (!recording.path) throw new NotFoundException('Recording has no file yet');
    return this.storage.resolve(recording.path);
  }

  /** A student reads a class recording through their enrollment, not
   * ownership (they didn't create it, their teacher did) — the check is
   * "are you in the class this recording belongs to", via the live
   * class's batchId. An ad-hoc class (started outside a My Classes
   * roster) has no batchId, so its recordings are never student-readable
   * — there is no roster to check against, and no My Classes entry for
   * them to appear under either (see ClassHistoryService). */
  async getFilePathForStudent(id: string, studentId: string): Promise<string> {
    const recording = await this.prisma.recording.findUnique({
      where: { id },
      include: { liveClass: { select: { batchId: true } } },
    });
    if (!recording || recording.kind !== RecordingKind.CLASS_BROADCAST) {
      throw new NotFoundException('Recording not found');
    }
    const batchId = recording.liveClass?.batchId;
    if (!batchId) throw new ForbiddenException('This recording is not part of a class you can access');
    const enrolled = await this.prisma.enrollment.findUnique({
      where: { userId_batchId: { userId: studentId, batchId } },
    });
    if (!enrolled) throw new ForbiddenException('You are not in this class');
    if (!recording.path) throw new NotFoundException('Recording has no file yet');
    return this.storage.resolve(recording.path);
  }

  async remove(id: string, user: JwtPayload): Promise<void> {
    const recording = await this.getOwned(id, user);
    if (recording.path) {
      await unlink(this.storage.resolve(recording.path)).catch(() => undefined);
    }
    await this.prisma.recording.delete({ where: { id } });
  }
}
