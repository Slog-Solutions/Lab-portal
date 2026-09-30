import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { ActivityType, AttemptStatus, UserRole, type CreatePronunciationExerciseDto } from '@lab/shared';
import { getActivity } from '@lab/shared/activities';
import type { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../prisma/prisma.service';
import type { EnvConfig } from '../../config/env.validation';
import { AuditService } from '../audit/audit.service';
import { BatchAccessService } from '../batches/batch-access.service';
import type { JwtPayload } from '../auth/auth.service';

const execFileAsync = promisify(execFile);

export interface SpeakResult {
  ipa: string | null;
  audioBase64: string | null;
  warnings: string[];
}

/** Enough for a class-sized test word list plus a session of free practice. */
const SPEAK_CACHE_MAX = 200;
/** Each Piper run loads a whole ONNX voice model into memory — a class
 * of students each typing a different word must queue rather than spawn
 * one process apiece. */
const MAX_CONCURRENT_SYNTHESIS = 3;
/** eSpeak-NG's G2P pass is plain text processing (no audio rendering), so
 * even a 10,000-word passage finishes in well under a minute — this just
 * guards against a hung process. */
const IPA_TIMEOUT_MS = 60_000;
/** Piper renders actual audio, so its wall-clock cost scales with the text:
 * a 10,000-word passage is a real book chapter's worth of speech, and on a
 * modest CPU that can take several minutes to synthesize. Generous on
 * purpose — a timeout here fails a long passage outright with no partial
 * result. */
const PIPER_TIMEOUT_MS = 20 * 60_000;

/** child_process.execFile has no stdin-piping option (that's only on the
 * *Sync variants) — spawn + manually writing/ending stdin is the correct
 * way to feed Piper text over stdin while still capturing a clean exit. */
function runWithStdin(bin: string, args: string[], input: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `exited with code ${code}`));
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}

/**
 * Offline speech pipeline (build plan "Speech (offline)": eSpeak-NG for
 * G2P->IPA, Piper for model-voice audio — no cloud speech API is possible
 * air-gapped). Neither binary is vendored into this repo (that's
 * infra/offline/'s job at deployment time); on a dev machine without them
 * installed, this degrades to a clear 503 rather than a stack trace deep
 * inside a spawn call — the same honesty pattern native-bridge uses for
 * its own platform-dependent gap (input-lock blocking with no C++
 * toolchain on the build machine).
 */
@Injectable()
export class PronunciationService {
  /** Holds the PROMISE, not the result, so concurrent requests for the
   * same word share one synthesis run (30 students pressing "Hear the
   * word" at once spawn Piper once). Map insertion order doubles as LRU
   * order — see speak(). */
  private readonly speakCache = new Map<string, Promise<SpeakResult>>();
  private activeSynthesis = 0;
  private readonly synthesisWaiters: Array<() => void> = [];

  constructor(
    private readonly config: ConfigService<EnvConfig, true>,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly batchAccess: BatchAccessService,
  ) {}

  /** One-step author-and-send: a sentence, paragraph or single word becomes
   * a PRONUNCIATION exercise and every named student is assigned it, in one
   * transaction — same shape as PronunciationTestsService.create for the
   * word-list test. Deliberately does NOT call generateIpa/generateModelAudio
   * here: that used to gate saving on the offline pipeline being reachable
   * and fast; now both the student's "Listen to pronunciation" button and
   * the teacher's review preview synthesize on demand instead (speak(),
   * below), so this returns as soon as the database writes do. */
  async createExercise(user: JwtPayload, dto: CreatePronunciationExerciseDto) {
    const teacherId = user.sub;
    const parsed = getActivity(ActivityType.PRONUNCIATION).configSchema.safeParse({
      sourceText: dto.sourceText,
      voice: dto.voice,
    });
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Invalid pronunciation exercise', issues: parsed.error.issues });
    }

    const studentIds = [...new Set(dto.studentIds)];
    const students = await this.prisma.user.findMany({
      where: { id: { in: studentIds }, role: UserRole.STUDENT, active: true },
      select: { id: true },
    });
    if (students.length !== studentIds.length) {
      const found = new Set(students.map((s) => s.id));
      throw new BadRequestException(`Not active students: ${studentIds.filter((id) => !found.has(id)).join(', ')}`);
    }

    if (dto.batchId) await this.assertClassRoster(user, dto.batchId, studentIds);

    // One transaction: an exercise that exists without its assignments is
    // unusable and confusing to clean up by hand.
    const exercise = await this.prisma.$transaction(async (tx) => {
      const created = await tx.exercise.create({
        data: { teacherId, type: ActivityType.PRONUNCIATION, title: dto.title, config: parsed.data as Prisma.InputJsonValue },
      });
      await tx.assignment.createMany({
        data: studentIds.map((studentId) => ({ teacherId, studentId, exerciseId: created.id, dueAt: dto.dueAt, batchId: dto.batchId })),
      });
      return created;
    });

    await this.audit.log({
      actorId: teacherId,
      action: 'pronunciation.create',
      detail: { exerciseId: exercise.id, students: studentIds.length },
    });
    return { exerciseId: exercise.id, title: exercise.title, assigned: studentIds.length };
  }

  /** An exercise created from a class is filed under it for the students'
   * class history, so the teacher must teach that class and every student
   * must be in it — same check as AssessmentsService's / GradebookService's. */
  private async assertClassRoster(user: JwtPayload, batchId: string, studentIds: string[]): Promise<void> {
    await this.batchAccess.assertCanUseBatch(user, batchId);
    const enrolled = await this.prisma.enrollment.count({ where: { batchId, userId: { in: studentIds } } });
    if (enrolled !== studentIds.length) {
      throw new BadRequestException('Some of these students are not in this class');
    }
  }

  isConfigured(): { ipa: boolean; voice: boolean } {
    return {
      ipa: Boolean(this.config.get('ESPEAK_NG_BIN', { infer: true })),
      voice: Boolean(this.config.get('PIPER_BIN', { infer: true }) && this.config.get('PIPER_VOICES_DIR', { infer: true })),
    };
  }

  /** Build the env for eSpeak-NG child process. When the binary is run from
   * a portable (non-installed) extraction, it needs ESPEAK_DATA_PATH set to
   * the espeak-ng-data folder alongside the exe; without it the binary
   * crashes with an access violation looking for the data in its compiled-in
   * default path (C:\\Program Files\\eSpeak NG\\espeak-ng-data). */
  private espeakEnv(): NodeJS.ProcessEnv | undefined {
    const dataPath = this.config.get('ESPEAK_NG_DATA', { infer: true });
    if (!dataPath) return undefined;
    return { ...process.env, ESPEAK_DATA_PATH: dataPath };
  }

  /** On-demand IPA + model voice for one word/phrase (student practice, a
   * pronunciation test's "hear the word" button, teacher grading). Unlike
   * generateIpa/generateModelAudio each half fails soft into `warnings` —
   * the same posture PronunciationController.generate takes — so a
   * seat without Piper still gets the IPA and vice versa. */
  speak(text: string, voice: 'en_US' | 'en_GB'): Promise<SpeakResult> {
    const normalized = text.trim().replace(/\s+/g, ' ');
    const key = `${voice}|${normalized}`;

    const hit = this.speakCache.get(key);
    if (hit) {
      this.speakCache.delete(key);
      this.speakCache.set(key, hit); // re-insert = most recently used
      return hit;
    }

    const pending = this.synthesize(normalized, voice);
    this.speakCache.set(key, pending);
    // A run where either half failed is worth retrying next time (a
    // transient Piper timeout must not stay cached for the process's
    // lifetime) — only successful runs stay. Concurrent callers already
    // holding this promise still share the failed result.
    void pending.then((result) => {
      if (result.warnings.length > 0 && this.speakCache.get(key) === pending) this.speakCache.delete(key);
    });
    while (this.speakCache.size > SPEAK_CACHE_MAX) {
      const oldest = this.speakCache.keys().next().value;
      if (oldest === undefined) break;
      this.speakCache.delete(oldest);
    }
    return pending;
  }

  private async synthesize(text: string, voice: 'en_US' | 'en_GB'): Promise<SpeakResult> {
    const warnings: string[] = [];
    const [ipa, audioBase64] = await Promise.all([
      this.generateIpa(text).catch((err: Error) => {
        warnings.push(err.message);
        return null;
      }),
      this.withSynthesisSlot(() => this.generateModelAudio(text, voice))
        .then((wav) => wav.toString('base64'))
        .catch((err: Error) => {
          warnings.push(err.message);
          return null;
        }),
    ]);
    return { ipa, audioBase64, warnings };
  }

  /** Counting semaphore. A finishing run hands its slot straight to the
   * next waiter (rather than decrementing then letting the waiter
   * re-increment), so a fresh caller can never slip in between and push
   * the active count past the cap. */
  private async withSynthesisSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeSynthesis < MAX_CONCURRENT_SYNTHESIS) {
      this.activeSynthesis += 1;
    } else {
      await new Promise<void>((resolve) => this.synthesisWaiters.push(resolve));
    }
    try {
      return await fn();
    } finally {
      const next = this.synthesisWaiters.shift();
      if (next) next();
      else this.activeSynthesis -= 1;
    }
  }

  /** Teacher-authored PRONUNCIATION exercises a student may practise
   * without an assignment (mirrors StudyLibraryPanel's open-catalogue
   * posture). Only the display text is exposed — the config's asset ids
   * are fetched by the player itself once an attempt starts. */
  async listPracticeExercises(): Promise<Array<{ id: string; title: string; sourceText: string }>> {
    const rows = await this.prisma.exercise.findMany({
      where: { type: ActivityType.PRONUNCIATION },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, config: true },
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      sourceText: (r.config as { sourceText?: string } | null)?.sourceText ?? '',
    }));
  }

  /** Every PRONUNCIATION exercise with its assignment progress, for the
   * teacher's "Your Pronunciation Exercises" table — same shape as
   * PronunciationTestsService.list(). Lab-wide, like ExercisesService.list:
   * exercises are shared teaching material. */
  async listExercisesForTeacher() {
    const exercises = await this.prisma.exercise.findMany({
      where: { type: ActivityType.PRONUNCIATION },
      orderBy: { createdAt: 'desc' },
      include: {
        teacher: { select: { fullName: true } },
        assignments: { select: { id: true, attempts: { select: { status: true } } } },
      },
    });
    return exercises.map((ex) => ({
      id: ex.id,
      title: ex.title,
      createdAt: ex.createdAt,
      teacherName: ex.teacher.fullName,
      config: ex.config as { sourceText?: string; voice?: string; ipaAssetId?: string; modelAudioAssetId?: string },
      assigned: ex.assignments.length,
      submitted: ex.assignments.filter((a) =>
        a.attempts.some((t) => t.status === AttemptStatus.SUBMITTED || t.status === AttemptStatus.SCORED),
      ).length,
      reviewed: ex.assignments.filter((a) => a.attempts.some((t) => t.status === AttemptStatus.SCORED)).length,
    }));
  }

  /** Grapheme-to-phoneme via eSpeak-NG, `--ipa` output. Text goes in through
   * a temp file (`-f`), never as a CLI argument — Windows caps a whole
   * command line (CreateProcess) at ~32K characters, which a multi-thousand-
   * word passage can exceed on its own; a file path is always short. */
  async generateIpa(text: string): Promise<string> {
    const bin = this.config.get('ESPEAK_NG_BIN', { infer: true });
    if (!bin) {
      throw new ServiceUnavailableException(
        'eSpeak-NG is not configured (ESPEAK_NG_BIN) — pronunciation exercises can still record/play back, just without generated IPA',
      );
    }
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'espeak-'));
    const inPath = path.join(tempDir, 'in.txt');
    try {
      await writeFile(inPath, text, 'utf-8');
      const { stdout } = await execFileAsync(bin, ['-q', '--ipa', '-x', '-f', inPath], {
        timeout: IPA_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
        env: this.espeakEnv(),
      });
      return stdout.trim();
    } catch (err) {
      throw new ServiceUnavailableException(`eSpeak-NG failed: ${(err as Error).message}`);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  /** Model-voice audio via Piper. Voice files follow Piper's standard
   * release layout: `<voice>.onnx` + `<voice>.onnx.json` in PIPER_VOICES_DIR. */
  async generateModelAudio(text: string, voice: 'en_US' | 'en_GB'): Promise<Buffer> {
    const bin = this.config.get('PIPER_BIN', { infer: true });
    const voicesDir = this.config.get('PIPER_VOICES_DIR', { infer: true });
    if (!bin || !voicesDir) {
      throw new ServiceUnavailableException(
        'Piper is not configured (PIPER_BIN/PIPER_VOICES_DIR) — pronunciation exercises can still record/play back, just without generated model audio',
      );
    }
    const modelPath = path.join(voicesDir, `${voice}.onnx`);
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'piper-'));
    const outPath = path.join(tempDir, 'out.wav');
    try {
      await runWithStdin(bin, ['--model', modelPath, '--output_file', outPath], text, PIPER_TIMEOUT_MS);
      return await readFile(outPath);
    } catch (err) {
      throw new ServiceUnavailableException(`Piper failed: ${(err as Error).message}`);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
