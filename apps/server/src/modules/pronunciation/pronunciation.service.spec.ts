import { describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { ActivityType, type CreatePronunciationExerciseDto } from '@lab/shared';
import { PronunciationService } from './pronunciation.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { BatchAccessService } from '../batches/batch-access.service';
import type { JwtPayload } from '../auth/auth.service';

function makeService() {
  const service = new PronunciationService(
    { get: vi.fn() } as unknown as ConfigService<never, true>,
    {} as unknown as PrismaService,
    { log: vi.fn() } as unknown as AuditService,
    { assertCanUseBatch: vi.fn() } as unknown as BatchAccessService,
  );
  const ipa = vi.spyOn(service, 'generateIpa').mockResolvedValue('θˈʌɹə');
  const audio = vi.spyOn(service, 'generateModelAudio').mockResolvedValue(Buffer.from('wav-bytes'));
  return { service, ipa, audio };
}

describe('PronunciationService.speak', () => {
  it('returns the IPA and the audio as base64', async () => {
    const { service } = makeService();
    expect(await service.speak('thorough', 'en_GB')).toEqual({
      ipa: 'θˈʌɹə',
      audioBase64: Buffer.from('wav-bytes').toString('base64'),
      warnings: [],
    });
  });

  it('runs synthesis once when a whole class asks for the same word at the same time', async () => {
    const { service, audio } = makeService();
    await Promise.all(Array.from({ length: 30 }, () => service.speak('thorough', 'en_GB')));
    expect(audio).toHaveBeenCalledTimes(1);
  });

  it('serves a finished word from cache, but treats voice and spelling variants separately', async () => {
    const { service, audio } = makeService();
    await service.speak('thorough', 'en_GB');
    await service.speak('  thorough  ', 'en_GB'); // whitespace-normalised -> same entry
    expect(audio).toHaveBeenCalledTimes(1);

    await service.speak('thorough', 'en_US');
    await service.speak('rural', 'en_GB');
    expect(audio).toHaveBeenCalledTimes(3);
  });

  it('does not cache a run where a half failed, so the next request retries', async () => {
    const { service, audio } = makeService();
    audio.mockRejectedValueOnce(new Error('Piper timed out'));

    const first = await service.speak('thorough', 'en_GB');
    expect(first).toMatchObject({ ipa: 'θˈʌɹə', audioBase64: null, warnings: ['Piper timed out'] });

    const second = await service.speak('thorough', 'en_GB');
    expect(second.audioBase64).not.toBeNull();
    expect(audio).toHaveBeenCalledTimes(2);
  });

  it('keeps the other half when one is unavailable (no Piper -> still IPA)', async () => {
    const { service, audio } = makeService();
    audio.mockRejectedValue(new Error('Piper is not configured'));
    expect(await service.speak('thorough', 'en_GB')).toEqual({
      ipa: 'θˈʌɹə',
      audioBase64: null,
      warnings: ['Piper is not configured'],
    });
  });

  it('never runs more than 3 syntheses at once; the rest queue', async () => {
    const { service, audio } = makeService();
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    audio.mockImplementation(
      () =>
        new Promise<Buffer>((resolve) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          releases.push(() => {
            active -= 1;
            resolve(Buffer.from('x'));
          });
        }),
    );

    const all = ['a', 'b', 'c', 'd', 'e'].map((w) => service.speak(w, 'en_GB'));
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    expect(active).toBe(3);

    while (releases.length > 0) {
      releases.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    }
    await Promise.all(all);
    expect(maxActive).toBe(3);
    expect(audio).toHaveBeenCalledTimes(5);
  });
});

/**
 * The one-step "author and send" flow: no separate Generate step, no
 * ipaAssetId/modelAudioAssetId in the saved config — those are synthesized
 * on demand instead (speak(), tested above). What's worth pinning here is
 * the database side: exercise + assignments in one transaction, the same
 * active-student and class-roster checks every other assignment path uses.
 */
describe('PronunciationService.createExercise', () => {
  const STUDENTS = ['s1', 's2'];
  const TEACHER_USER: JwtPayload = { sub: 'teacher1', role: 'TEACHER', serviceNumber: 'TCH-1' };
  const dto = (over: Partial<CreatePronunciationExerciseDto> = {}): CreatePronunciationExerciseDto => ({
    title: 'Unit 3 — daily routines',
    sourceText: 'The committee has decided to postpone the meeting.',
    voice: 'en_GB',
    studentIds: STUDENTS,
    ...over,
  });

  function setup() {
    const prisma = {
      user: { findMany: vi.fn().mockResolvedValue(STUDENTS.map((id) => ({ id }))) },
      enrollment: { count: vi.fn().mockResolvedValue(STUDENTS.length) },
      $transaction: vi.fn(),
    };
    const tx = {
      exercise: { create: vi.fn().mockResolvedValue({ id: 'ex1', title: 'Unit 3 — daily routines' }) },
      assignment: { createMany: vi.fn() },
    };
    prisma.$transaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
    const audit = { log: vi.fn() };
    const batchAccess = { assertCanUseBatch: vi.fn().mockResolvedValue(undefined) };
    const service = new PronunciationService(
      { get: vi.fn() } as unknown as ConfigService<never, true>,
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      batchAccess as unknown as BatchAccessService,
    );
    return { prisma, tx, audit, batchAccess, service };
  }

  it('creates the exercise with only sourceText/voice in config (no pre-generated assets) and assigns every student', async () => {
    const { tx, audit, service } = setup();

    const result = await service.createExercise(TEACHER_USER, dto());

    expect(result).toEqual({ exerciseId: 'ex1', title: 'Unit 3 — daily routines', assigned: 2 });
    expect(tx.exercise.create).toHaveBeenCalledWith({
      data: {
        teacherId: 'teacher1',
        type: ActivityType.PRONUNCIATION,
        title: 'Unit 3 — daily routines',
        config: { sourceText: 'The committee has decided to postpone the meeting.', voice: 'en_GB' },
      },
    });
    expect(tx.assignment.createMany).toHaveBeenCalledWith({
      data: [
        { teacherId: 'teacher1', studentId: 's1', exerciseId: 'ex1', dueAt: undefined, batchId: undefined },
        { teacherId: 'teacher1', studentId: 's2', exerciseId: 'ex1', dueAt: undefined, batchId: undefined },
      ],
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'pronunciation.create' }));
  });

  it('refuses inactive or unknown students without creating anything', async () => {
    const { prisma, tx, service } = setup();
    prisma.user.findMany.mockResolvedValue([{ id: 's1' }]); // s2 isn't an active student

    await expect(service.createExercise(TEACHER_USER, dto())).rejects.toThrow(/Not active students: s2/);
    expect(tx.exercise.create).not.toHaveBeenCalled();
  });

  describe('created from a class', () => {
    const CLASS_ID = 'class1';

    it('checks the teacher teaches the class and files every assignment under it', async () => {
      const { tx, batchAccess, service } = setup();

      await service.createExercise(TEACHER_USER, dto({ batchId: CLASS_ID }));

      expect(batchAccess.assertCanUseBatch).toHaveBeenCalledWith(TEACHER_USER, CLASS_ID);
      const rows = tx.assignment.createMany.mock.calls[0]![0].data as Array<{ batchId?: string }>;
      expect(rows.every((r) => r.batchId === CLASS_ID)).toBe(true);
    });

    it('refuses a student who is not in the class, writing nothing', async () => {
      const { prisma, tx, service } = setup();
      prisma.enrollment.count.mockResolvedValue(1);

      await expect(service.createExercise(TEACHER_USER, dto({ batchId: CLASS_ID }))).rejects.toThrow(/not in this class/);
      expect(tx.exercise.create).not.toHaveBeenCalled();
    });
  });
});
