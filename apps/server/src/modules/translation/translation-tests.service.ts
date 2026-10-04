import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { UserRole, type CreateTranslationTestDto } from '@lab/shared';
import { translationTestRoom } from '@lab/shared/events';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { MediaService } from '../media/media.service';
import { AuditService } from '../audit/audit.service';
import type { EnvConfig } from '../../config/env.validation';
import type { JwtPayload } from '../auth/auth.service';
import { TranslationSettingsService } from './translation-settings.service';
import { TranslatorClient } from './translator.client';

/** Subdir under LAB_DATA_ROOT holding every run's inputs and outputs. */
const TESTS_SUBDIR = 'translation-tests';


/**
 * The Translation Lab: a teacher uploads audio and watches the SAME
 * streaming pipeline a live class uses translate it.
 *
 * Deliberately not a separate batch code path. A "test" that ran the
 * model differently from the classroom would measure the wrong thing —
 * the whole point is tuning the latency students actually experience, so
 * `realtime` mode paces the file at 1x through a real LiveKit room and
 * the teacher auditions it with the student listener component.
 */
@Injectable()
export class TranslationTestsService {
  private readonly logger = new Logger(TranslationTestsService.name);
  private readonly translatorDataRoot: string | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly translator: TranslatorClient,
    private readonly settings: TranslationSettingsService,
    private readonly storage: StorageService,
    private readonly media: MediaService,
    private readonly audit: AuditService,
    config: ConfigService<EnvConfig, true>,
  ) {
    this.translatorDataRoot = config.get('TRANSLATOR_DATA_ROOT', { infer: true }) ?? null;
  }

  async create(
    user: JwtPayload,
    dto: CreateTranslationTestDto,
    file: { tempPath: string; originalName: string; mimeType: string },
  ): Promise<{ runId: string; room: string | null; token: string | null; status: string }> {
    if (!this.translator.configured) {
      await rm(file.tempPath, { force: true });
      throw new ServiceUnavailableException('Translation is not configured on this server');
    }
    // Checked before spending a GPU stream on a file we cannot decode.
    if (!/^(audio|video)\//.test(file.mimeType)) {
      await rm(file.tempPath, { force: true });
      throw new BadRequestException(`Expected an audio file, got ${file.mimeType}`);
    }

    const settings = await this.settings.get();
    const unknown = dto.langs.filter((l) => !settings.enabledLanguages.includes(l));
    if (unknown.length > 0) {
      await rm(file.tempPath, { force: true });
      throw new BadRequestException(`Not enabled for translation: ${unknown.join(', ')}`);
    }

    const run = await this.prisma.translationTestRun.create({
      data: {
        teacherId: user.sub,
        fileName: file.originalName,
        sourceLanguage: dto.sourceLanguage,
        langs: dto.langs,
        mode: dto.mode,
        status: 'queued',
      },
    });

    // The upload moves into the run's own directory, so a run is one
    // self-contained folder: input, per-language wavs and transcripts.
    // That makes "delete a run" a single rm, and lets the translator work
    // from a stable path rather than multer's temp name.
    const runDirRelative = path.posix.join(TESTS_SUBDIR, run.id);
    const runDirAbsolute = this.storage.resolve(runDirRelative);
    const ext = path.extname(file.originalName) || '.bin';
    const inputRelative = path.posix.join(runDirRelative, `input${ext}`);
    await mkdir(runDirAbsolute, { recursive: true });
    await rename(file.tempPath, this.storage.resolve(inputRelative));

    const realtime = dto.mode === 'realtime';
    const room = realtime ? translationTestRoom(run.id) : null;
    let token: string | null = null;
    let serviceToken: string | null = null;
    if (room) {
      await this.media.ensureRoom(room);
      serviceToken = await this.media.mintServiceToken({ scopeId: `trtest:${run.id}`, room, ttl: '2h' });
      // Listen-only for the teacher: the audio under test comes from the
      // file, and a publish right here would let their live mic leak into
      // a room they are monitoring on speakers.
      token = await this.media.mintListenerToken({
        identity: `st:teacher:${user.sub}`,
        displayName: 'Translation Lab',
        room,
      });
    }

    try {
      await this.translator.startTestRun({
        runId: run.id,
        audioPath: this.translatorPath(inputRelative),
        sourceLanguage: dto.sourceLanguage,
        targetLanguages: dto.langs,
        mode: dto.mode,
        engineParams: settings.engineParams,
        outputDir: this.translatorPath(runDirRelative),
        ...(room ? { room, livekitUrl: this.translator.livekitUrl, token: serviceToken! } : {}),
      });
      await this.prisma.translationTestRun.update({ where: { id: run.id }, data: { status: 'running' } });
    } catch (err) {
      const message = (err as Error).message;
      await this.prisma.translationTestRun.update({ where: { id: run.id }, data: { status: 'failed', error: message } });
      throw new ServiceUnavailableException(`The translation service rejected the run: ${message}`);
    }

    await this.audit.log({
      actorId: user.sub,
      action: 'translation.test.start',
      detail: { runId: run.id, langs: dto.langs, mode: dto.mode, fileName: file.originalName },
    });
    return { runId: run.id, room, token, status: 'running' };
  }

  /** Polled by the Translation Lab page while a run is in flight. Pulls
   * the translator's live view through on every call rather than waiting
   * for a callback — the translator stays stateless towards us, which is
   * what lets it be restarted mid-run without leaving a row stuck at
   * 'running' forever (the next poll reports the truth). */
  async get(user: JwtPayload, runId: string) {
    const run = await this.prisma.translationTestRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Test run not found');
    if (user.role !== UserRole.ADMIN && run.teacherId !== user.sub) {
      throw new ForbiddenException('This is not your test run');
    }

    let current = run;
    if (run.status === 'queued' || run.status === 'running') {
      try {
        const live = await this.translator.testRun(runId);
        if (live.status !== run.status) {
          current = await this.prisma.translationTestRun.update({
            where: { id: runId },
            data: {
              status: live.status,
              ...(live.error ? { error: live.error } : {}),
              ...(live.metrics ? { metrics: live.metrics as object } : {}),
              ...(live.durationMs ? { durationMs: live.durationMs } : {}),
            },
          });
        }
      } catch (err) {
        this.logger.debug(`Could not poll translator for run ${runId}: ${(err as Error).message}`);
      }
    }

    return { ...current, files: await this.outputFiles(runId) };
  }

  async list(user: JwtPayload, limit = 20) {
    return this.prisma.translationTestRun.findMany({
      where: user.role === UserRole.ADMIN ? {} : { teacherId: user.sub },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async remove(user: JwtPayload, runId: string): Promise<{ ok: true }> {
    const run = await this.prisma.translationTestRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Test run not found');
    if (user.role !== UserRole.ADMIN && run.teacherId !== user.sub) {
      throw new ForbiddenException('This is not your test run');
    }
    if (run.status === 'running' || run.status === 'queued') await this.translator.cancelTestRun(runId);
    await rm(this.storage.resolve(path.posix.join(TESTS_SUBDIR, runId)), { recursive: true, force: true });
    await this.prisma.translationTestRun.delete({ where: { id: runId } });
    return { ok: true };
  }

  /** Absolute path, on disk, of one of a run's output files. Resolved
   * through this method (never from a client-supplied path) so a crafted
   * language code cannot escape the run's directory. */
  async outputPath(user: JwtPayload, runId: string, fileName: string): Promise<string> {
    const run = await this.prisma.translationTestRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Test run not found');
    if (user.role !== UserRole.ADMIN && run.teacherId !== user.sub) {
      throw new ForbiddenException('This is not your test run');
    }
    const available = await this.outputFiles(runId);
    if (!available.includes(fileName)) throw new NotFoundException('No such output file for this run');
    return this.storage.resolve(path.posix.join(TESTS_SUBDIR, runId, fileName));
  }

  private async outputFiles(runId: string): Promise<string[]> {
    try {
      const entries = await readdir(this.storage.resolve(path.posix.join(TESTS_SUBDIR, runId)), { withFileTypes: true });
      return entries.filter((e) => e.isFile()).map((e) => e.name).sort();
    } catch {
      return [];
    }
  }

  /**
   * Maps a LabData-relative path to where the TRANSLATOR sees it.
   *
   * The two processes share the LabData volume but not necessarily the
   * same path to it: in compose the server mounts it at /data/LabData and
   * so does the translator, while a Windows dev run has both reading
   * D:\Lab Management\apps\server\LabData. TRANSLATOR_DATA_ROOT states
   * which, explicitly — guessing from the shape of LAB_DATA_ROOT would
   * silently hand the translator a path it cannot open, and the failure
   * would only show up as a run stuck at 'failed' with an ENOENT.
   */
  private translatorPath(relativePath: string): string {
    return this.translatorDataRoot
      ? path.posix.join(this.translatorDataRoot, relativePath)
      : this.storage.resolve(relativePath);
  }
}
