import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ActivityType, AttemptStatus } from '@lab/shared';
import { AttemptsService } from './attempts.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

/**
 * Ser 5/10's actual grading authority (this file's own doc comment: "a
 * randomized test-bank attempt can only be graded against the DB"). No
 * real Postgres here — a fake PrismaService is enough to exercise the
 * real scoring logic (`scoreVocabularyTest`, private) through the same
 * public `submit()` path a real request takes, which is both more
 * honest about what's actually being tested and avoids reaching into
 * private internals the way word-list-parser.ts's exported pure function
 * doesn't need to.
 *
 * Typed as a plain mock object here (not `PrismaService` — that would
 * hide the `.mockResolvedValue`/`.mockImplementation` methods these tests
 * actually call) and cast only at the `new AttemptsService(...)` call
 * site, where the real constructor type is what should be checked.
 */
function makeFakePrisma(overrides: Record<string, unknown> = {}) {
  return {
    exercise: { findUnique: vi.fn() },
    attempt: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    itemBank: { findUnique: vi.fn() },
    item: { findMany: vi.fn() },
    itemResponse: { createMany: vi.fn() },
    skillProgress: { create: vi.fn() },
    ...overrides,
  };
}

function makeFakeAudit() {
  return { log: vi.fn() };
}

function makeService(prisma: ReturnType<typeof makeFakePrisma>, audit: ReturnType<typeof makeFakeAudit>): AttemptsService {
  return new AttemptsService(prisma as unknown as PrismaService, audit as unknown as AuditService);
}

describe('AttemptsService — inline-mode vocabulary test scoring', () => {
  const exercise = {
    id: 'ex1',
    type: ActivityType.VOCABULARY_TEST,
    config: {
      shuffleItems: false,
      items: [
        { prompt: 'cat', answer: 'gato' },
        { prompt: 'dog', answer: 'Perro' }, // mixed case on purpose
      ],
    },
  };

  it('start() strips the answer key from served items (Phase 3\'s own real security bug, regression-guarded)', async () => {
    const prisma = makeFakePrisma();
    prisma.exercise.findUnique.mockResolvedValue(exercise);
    prisma.attempt.create.mockResolvedValue({ id: 'att1' });
    const service = makeService(prisma, makeFakeAudit());

    const result = await service.start('student1', { exerciseId: 'ex1' });

    expect(result.items).toEqual([
      { id: 'inline:0', prompt: 'cat', choices: [] },
      { id: 'inline:1', prompt: 'dog', choices: [] },
    ]);
    for (const item of result.items!) {
      expect(item).not.toHaveProperty('answer');
    }
  });

  it('grades 100% when every answer matches (case/whitespace-insensitive)', async () => {
    const prisma = makeFakePrisma();
    prisma.attempt.findUnique.mockResolvedValue({
      id: 'att1',
      studentId: 'student1',
      itemOrder: ['inline:0', 'inline:1'],
      status: AttemptStatus.IN_PROGRESS,
      exercise,
    });
    prisma.attempt.update.mockImplementation(({ data }: { data: unknown }) => Promise.resolve({ id: 'att1', ...(data as object) }));
    const service = makeService(prisma, makeFakeAudit());

    const result = await service.submit('att1', 'student1', {
      response: { answers: [], score: null },
      itemResponses: [
        { itemId: 'inline:0', given: '  Gato  ' }, // whitespace + case differ, should still match
        { itemId: 'inline:1', given: 'perro' },
      ],
    });

    expect(result).toMatchObject({ rawScore: 100, status: AttemptStatus.SCORED });
  });

  it('grades partial credit and records SkillProgress for a SCORED attempt', async () => {
    const prisma = makeFakePrisma();
    prisma.attempt.findUnique.mockResolvedValue({
      id: 'att1',
      studentId: 'student1',
      status: AttemptStatus.IN_PROGRESS,
      itemOrder: ['inline:0', 'inline:1'],
      exercise,
    });
    prisma.attempt.update.mockImplementation(({ data }: { data: unknown }) => Promise.resolve({ id: 'att1', ...(data as object) }));
    const service = makeService(prisma, makeFakeAudit());

    const result = await service.submit('att1', 'student1', {
      response: { answers: [], score: null },
      itemResponses: [
        { itemId: 'inline:0', given: 'gato' }, // correct
        { itemId: 'inline:1', given: 'wrong' }, // incorrect
      ],
    });

    expect(result).toMatchObject({ rawScore: 50, status: AttemptStatus.SCORED });
    expect(prisma.skillProgress.create).toHaveBeenCalledWith({
      data: { studentId: 'student1', skill: 'vocabulary', score: expect.any(Number) },
    });
  });

  it('never persists ItemResponse rows for inline items (they have no real Item row to point the FK at)', async () => {
    const prisma = makeFakePrisma();
    prisma.attempt.findUnique.mockResolvedValue({ id: 'att1', studentId: 'student1', status: AttemptStatus.IN_PROGRESS, itemOrder: ['inline:0', 'inline:1'], exercise });
    prisma.attempt.update.mockImplementation(({ data }: { data: unknown }) => Promise.resolve({ id: 'att1', ...(data as object) }));
    const service = makeService(prisma, makeFakeAudit());

    await service.submit('att1', 'student1', {
      response: { answers: [], score: null },
      itemResponses: [{ itemId: 'inline:0', given: 'gato' }],
    });

    expect(prisma.itemResponse.createMany).not.toHaveBeenCalled();
  });

  it('rejects submitting an attempt that belongs to a different student', async () => {
    const prisma = makeFakePrisma();
    prisma.attempt.findUnique.mockResolvedValue({ id: 'att1', studentId: 'someone-else', itemOrder: [], exercise });
    const service = makeService(prisma, makeFakeAudit());

    await expect(service.submit('att1', 'student1', { response: {} })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects submitting an already-submitted attempt', async () => {
    const prisma = makeFakePrisma();
    prisma.attempt.findUnique.mockResolvedValue({
      id: 'att1',
      studentId: 'student1',
      status: AttemptStatus.SCORED,
      itemOrder: [],
      exercise,
    });
    const service = makeService(prisma, makeFakeAudit());

    await expect(service.submit('att1', 'student1', { response: {} })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects starting a live-session-only activity type (e.g. ROUND_TABLE) through this endpoint', async () => {
    const prisma = makeFakePrisma();
    prisma.exercise.findUnique.mockResolvedValue({ id: 'ex2', type: ActivityType.ROUND_TABLE, config: {} });
    const service = makeService(prisma, makeFakeAudit());

    await expect(service.start('student1', { exerciseId: 'ex2' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

/**
 * Ser 7 pronunciation TEST (teacher gives words, student records each).
 * The rules worth pinning here are the server-side ones a client can't be
 * trusted with: one submission per assignment, start only via the
 * student's own assignment, and every word backed by its own finished
 * recording of THIS attempt.
 */
describe('AttemptsService — pronunciation test', () => {
  const exercise = { id: 'ex1', type: ActivityType.PRONUNCIATION_TEST, config: { playModelAudio: false, voice: 'en_GB' } };
  const words = [
    { id: 'w1', prompt: 'thorough', answer: 'thorough', mediaAssetId: 'should-never-be-served', order: 0 },
    { id: 'w2', prompt: 'rural', answer: 'rural', mediaAssetId: null, order: 1 },
  ];

  function makePrisma() {
    return {
      exercise: { findUnique: vi.fn().mockResolvedValue(exercise) },
      assignment: { findUnique: vi.fn().mockResolvedValue({ id: 'as1', studentId: 'student1', exerciseId: 'ex1' }) },
      attempt: { create: vi.fn().mockResolvedValue({ id: 'att1' }), findUnique: vi.fn(), update: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      itemBank: { findUnique: vi.fn().mockResolvedValue({ id: 'bank1', exerciseId: 'ex1', items: words }) },
      item: { findMany: vi.fn().mockResolvedValue(words.map((w) => ({ id: w.id, prompt: w.prompt }))) },
      itemResponse: { createMany: vi.fn() },
      recording: { findMany: vi.fn() },
      skillProgress: { create: vi.fn() },
    };
  }
  function makeSvc(prisma: ReturnType<typeof makePrisma>): AttemptsService {
    return new AttemptsService(prisma as unknown as PrismaService, makeFakeAudit() as unknown as AuditService);
  }

  describe('start()', () => {
    it('refuses to start without an assignment', async () => {
      const svc = makeSvc(makePrisma());
      await expect(svc.start('student1', { exerciseId: 'ex1' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it("refuses another student's assignment", async () => {
      const prisma = makePrisma();
      prisma.assignment.findUnique.mockResolvedValue({ id: 'as1', studentId: 'someone-else', exerciseId: 'ex1' });
      await expect(makeSvc(prisma).start('student1', { exerciseId: 'ex1', assignmentId: 'as1' })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('refuses an assignment that is for a different exercise', async () => {
      const prisma = makePrisma();
      prisma.assignment.findUnique.mockResolvedValue({ id: 'as1', studentId: 'student1', exerciseId: 'other-exercise' });
      await expect(makeSvc(prisma).start('student1', { exerciseId: 'ex1', assignmentId: 'as1' })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('locks the test once an attempt on that assignment is submitted or scored (one submission only)', async () => {
      const prisma = makePrisma();
      prisma.attempt.count.mockResolvedValue(1);
      const svc = makeSvc(prisma);

      await expect(svc.start('student1', { exerciseId: 'ex1', assignmentId: 'as1' })).rejects.toThrow(/already submitted/);
      expect(prisma.attempt.count).toHaveBeenCalledWith({
        where: { assignmentId: 'as1', status: { in: [AttemptStatus.SUBMITTED, AttemptStatus.SCORED] } },
      });
      expect(prisma.attempt.create).not.toHaveBeenCalled();
    });

    it('serves the words in authored order with no answer key and no media', async () => {
      const prisma = makePrisma();
      const result = await makeSvc(prisma).start('student1', { exerciseId: 'ex1', assignmentId: 'as1' });

      expect(result.items).toEqual([
        { id: 'w1', prompt: 'thorough', choices: [] },
        { id: 'w2', prompt: 'rural', choices: [] },
      ]);
      expect(prisma.attempt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ itemOrder: ['w1', 'w2'], maxScore: 100, assignmentId: 'as1' }),
      });
    });

    it('refuses a test with no words', async () => {
      const prisma = makePrisma();
      prisma.itemBank.findUnique.mockResolvedValue({ id: 'bank1', exerciseId: 'ex1', items: [] });
      await expect(makeSvc(prisma).start('student1', { exerciseId: 'ex1', assignmentId: 'as1' })).rejects.toThrow(/no words/);
    });
  });

  describe('submit()', () => {
    function inProgress(prisma: ReturnType<typeof makePrisma>) {
      prisma.attempt.findUnique.mockResolvedValue({
        id: 'att1',
        studentId: 'student1',
        status: AttemptStatus.IN_PROGRESS,
        itemOrder: ['w1', 'w2'],
        exercise,
      });
      prisma.attempt.update.mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: 'att1', ...data }));
    }

    it('rejects a word with no recording, naming the word', async () => {
      const prisma = makePrisma();
      inProgress(prisma);
      prisma.recording.findMany.mockResolvedValue([{ id: 'rec1' }]);

      await expect(
        makeSvc(prisma).submit('att1', 'student1', { response: {}, itemResponses: [{ itemId: 'w1', given: 'rec1' }] }),
      ).rejects.toThrow(/missing: rural/);
      expect(prisma.itemResponse.createMany).not.toHaveBeenCalled();
    });

    it('only counts recordings of THIS attempt that finished uploading', async () => {
      const prisma = makePrisma();
      inProgress(prisma);
      prisma.recording.findMany.mockResolvedValue([{ id: 'rec1' }]); // rec2 isn't ready / isn't this attempt's

      await expect(
        makeSvc(prisma).submit('att1', 'student1', {
          response: {},
          itemResponses: [
            { itemId: 'w1', given: 'rec1' },
            { itemId: 'w2', given: 'rec2' },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.recording.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['rec1', 'rec2'] }, attemptId: 'att1', status: 'ready' },
        select: { id: true },
      });
    });

    it('rejects one recording reused for two words', async () => {
      const prisma = makePrisma();
      inProgress(prisma);
      prisma.recording.findMany.mockResolvedValue([{ id: 'rec1' }]);

      await expect(
        makeSvc(prisma).submit('att1', 'student1', {
          response: {},
          itemResponses: [
            { itemId: 'w1', given: 'rec1' },
            { itemId: 'w2', given: 'rec1' },
          ],
        }),
      ).rejects.toThrow(/own recording/);
    });

    it('stores one ItemResponse per word, leaves the attempt SUBMITTED and unscored', async () => {
      const prisma = makePrisma();
      inProgress(prisma);
      prisma.recording.findMany.mockResolvedValue([{ id: 'rec1' }, { id: 'rec2' }]);

      const result = await makeSvc(prisma).submit('att1', 'student1', {
        response: {},
        itemResponses: [
          { itemId: 'w2', given: 'rec2' }, // sent out of order on purpose
          { itemId: 'w1', given: 'rec1' },
        ],
      });

      expect(result).toMatchObject({ rawScore: null, status: AttemptStatus.SUBMITTED });
      expect(prisma.itemResponse.createMany).toHaveBeenCalledWith({
        data: [
          { attemptId: 'att1', itemId: 'w1', given: 'rec1', order: 0 },
          { attemptId: 'att1', itemId: 'w2', given: 'rec2', order: 1 },
        ],
      });
      expect(prisma.skillProgress.create).not.toHaveBeenCalled(); // nothing to record until a teacher scores it
    });
  });
});

/**
 * Ser 7 single-text pronunciation (free practice / assigned exercise). A
 * student can Improvise (discard + re-record) any number of times before
 * submitting, so submit() can't trust the claimed recording id blindly —
 * ActivityRecorder.stop() only console.error's a failed upload, so the
 * server must check the claimed recording actually finished uploading and
 * belongs to THIS attempt (AttemptsService.submitPronunciation).
 */
describe('AttemptsService — pronunciation (single-text)', () => {
  const exercise = { id: 'ex1', type: ActivityType.PRONUNCIATION, config: { sourceText: 'Say this clearly.', voice: 'en_GB' } };
  const RECORDING_ID = 'clh3am1r30000qzrmn831rec';

  function makePrisma() {
    return {
      attempt: {
        findUnique: vi.fn().mockResolvedValue({ id: 'att1', studentId: 'student1', status: AttemptStatus.IN_PROGRESS, itemOrder: [], exercise }),
        update: vi.fn().mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: 'att1', ...data })),
      },
      recording: { findUnique: vi.fn() },
      skillProgress: { create: vi.fn() },
    };
  }
  function makeSvc(prisma: ReturnType<typeof makePrisma>): AttemptsService {
    return new AttemptsService(prisma as unknown as PrismaService, makeFakeAudit() as unknown as AuditService);
  }

  it('accepts a ready recording that belongs to this attempt, carrying the self-score unscored', async () => {
    const prisma = makePrisma();
    prisma.recording.findUnique.mockResolvedValue({ attemptId: 'att1', status: 'ready' });

    const result = await makeSvc(prisma).submit('att1', 'student1', {
      response: { studentAudioAssetId: RECORDING_ID, selfAssessedScore: 4 },
    });

    expect(prisma.recording.findUnique).toHaveBeenCalledWith({ where: { id: RECORDING_ID }, select: { attemptId: true, status: true } });
    expect(result).toMatchObject({ rawScore: 4, status: AttemptStatus.SUBMITTED });
  });

  it('rejects a recording that never finished uploading (an Improvise take still stuck as "pending")', async () => {
    const prisma = makePrisma();
    prisma.recording.findUnique.mockResolvedValue({ attemptId: 'att1', status: 'pending' });

    await expect(
      makeSvc(prisma).submit('att1', 'student1', { response: { studentAudioAssetId: RECORDING_ID } }),
    ).rejects.toThrow(/did not finish uploading/);
  });

  it("rejects a recording that belongs to a different attempt (can't claim someone else's take)", async () => {
    const prisma = makePrisma();
    prisma.recording.findUnique.mockResolvedValue({ attemptId: 'someone-elses-attempt', status: 'ready' });

    await expect(
      makeSvc(prisma).submit('att1', 'student1', { response: { studentAudioAssetId: RECORDING_ID } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an id for a recording that does not exist', async () => {
    const prisma = makePrisma();
    prisma.recording.findUnique.mockResolvedValue(null);

    await expect(
      makeSvc(prisma).submit('att1', 'student1', { response: { studentAudioAssetId: RECORDING_ID } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

/**
 * READING_TEST — structurally a WRITING_TEST with an audio recording
 * instead of typed text: the passage is served as this attempt's one bank
 * item (same "no answer key, authored order" arm as PRONUNCIATION_TEST and
 * WRITING_TEST), one-shot like every other teacher-created test, and the
 * submitted take is verified the same way PRONUNCIATION's is (Improvise can
 * leave a stale "pending" recording lying around) before being persisted as
 * that one item's ItemResponse — never left in the response payload, so the
 * teacher's results page finds it the same way it finds a written essay.
 */
describe('AttemptsService — reading test', () => {
  const exercise = { id: 'ex1', type: ActivityType.READING_TEST, config: { voice: 'en_GB' } };
  const passageItem = { id: 'p1', prompt: 'The quick brown fox jumps over the lazy dog.', answer: '', order: 0 };
  const RECORDING_ID = 'clh3am1r30000qzrmn831rec';

  function makePrisma() {
    return {
      exercise: { findUnique: vi.fn().mockResolvedValue(exercise) },
      assignment: { findUnique: vi.fn().mockResolvedValue({ id: 'as1', studentId: 'student1', exerciseId: 'ex1' }) },
      attempt: {
        create: vi.fn().mockResolvedValue({ id: 'att1' }),
        findUnique: vi.fn(),
        update: vi.fn().mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: 'att1', ...data })),
        count: vi.fn().mockResolvedValue(0),
      },
      itemBank: { findUnique: vi.fn().mockResolvedValue({ id: 'bank1', exerciseId: 'ex1', items: [passageItem] }) },
      recording: { findUnique: vi.fn() },
      itemResponse: { createMany: vi.fn() },
      skillProgress: { create: vi.fn() },
    };
  }
  function makeSvc(prisma: ReturnType<typeof makePrisma>): AttemptsService {
    return new AttemptsService(prisma as unknown as PrismaService, makeFakeAudit() as unknown as AuditService);
  }

  describe('start()', () => {
    it('refuses to start without an assignment', async () => {
      await expect(makeSvc(makePrisma()).start('student1', { exerciseId: 'ex1' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('locks the test once an attempt on that assignment is submitted or scored (one submission only)', async () => {
      const prisma = makePrisma();
      prisma.attempt.count.mockResolvedValue(1);
      await expect(makeSvc(prisma).start('student1', { exerciseId: 'ex1', assignmentId: 'as1' })).rejects.toThrow(/already submitted/);
      expect(prisma.attempt.create).not.toHaveBeenCalled();
    });

    it('serves the passage with no answer key, maxScore 100', async () => {
      const prisma = makePrisma();
      const result = await makeSvc(prisma).start('student1', { exerciseId: 'ex1', assignmentId: 'as1' });

      expect(result.items).toEqual([{ id: 'p1', prompt: 'The quick brown fox jumps over the lazy dog.', choices: [] }]);
      expect(prisma.attempt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ itemOrder: ['p1'], maxScore: 100, assignmentId: 'as1' }),
      });
    });

    it('also serves the uploaded document (mediaAssetId) when the teacher gave one instead of, or with, a passage', async () => {
      const prisma = makePrisma();
      prisma.itemBank.findUnique.mockResolvedValue({
        id: 'bank1',
        exerciseId: 'ex1',
        items: [{ ...passageItem, prompt: '', mediaAssetId: 'doc1' }],
      });

      const result = await makeSvc(prisma).start('student1', { exerciseId: 'ex1', assignmentId: 'as1' });

      expect(result.items).toEqual([{ id: 'p1', prompt: '', choices: [], mediaAssetId: 'doc1' }]);
    });

    it('refuses a test with no passage', async () => {
      const prisma = makePrisma();
      prisma.itemBank.findUnique.mockResolvedValue({ id: 'bank1', exerciseId: 'ex1', items: [] });
      await expect(makeSvc(prisma).start('student1', { exerciseId: 'ex1', assignmentId: 'as1' })).rejects.toThrow(/no passage/);
    });
  });

  describe('submit()', () => {
    function inProgress(prisma: ReturnType<typeof makePrisma>) {
      prisma.attempt.findUnique.mockResolvedValue({ id: 'att1', studentId: 'student1', status: AttemptStatus.IN_PROGRESS, itemOrder: ['p1'], exercise });
    }

    it('accepts a ready recording that belongs to this attempt, leaving it SUBMITTED and unscored', async () => {
      const prisma = makePrisma();
      inProgress(prisma);
      prisma.recording.findUnique.mockResolvedValue({ attemptId: 'att1', status: 'ready' });

      const result = await makeSvc(prisma).submit('att1', 'student1', { response: { studentAudioAssetId: RECORDING_ID } });

      expect(result).toMatchObject({ rawScore: null, status: AttemptStatus.SUBMITTED });
      expect(prisma.itemResponse.createMany).toHaveBeenCalledWith({
        data: [{ attemptId: 'att1', itemId: 'p1', given: RECORDING_ID, order: 0 }],
      });
      expect(prisma.skillProgress.create).not.toHaveBeenCalled(); // nothing to record until a teacher scores it
    });

    it('rejects a recording that never finished uploading (a re-record still stuck as "pending")', async () => {
      const prisma = makePrisma();
      inProgress(prisma);
      prisma.recording.findUnique.mockResolvedValue({ attemptId: 'att1', status: 'pending' });

      await expect(
        makeSvc(prisma).submit('att1', 'student1', { response: { studentAudioAssetId: RECORDING_ID } }),
      ).rejects.toThrow(/did not finish uploading/);
      expect(prisma.itemResponse.createMany).not.toHaveBeenCalled();
    });

    it("rejects a recording that belongs to a different attempt (can't claim someone else's take)", async () => {
      const prisma = makePrisma();
      inProgress(prisma);
      prisma.recording.findUnique.mockResolvedValue({ attemptId: 'someone-elses-attempt', status: 'ready' });

      await expect(
        makeSvc(prisma).submit('att1', 'student1', { response: { studentAudioAssetId: RECORDING_ID } }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});

/**
 * Teacher-created writing and listening tests. A writing test can only be
 * marked by a person, so the server's job is to enforce the word limits the
 * console merely displays and to leave the attempt SUBMITTED; a listening
 * test scores itself against the stored answer key, which must never reach
 * the student — and the correct choice must not sit in a fixed slot.
 */
describe('AttemptsService — writing and listening tests', () => {
  const writing = { id: 'wx', type: ActivityType.WRITING_TEST, config: { minWords: 3, maxWords: 6 } };
  const listening = { id: 'lx', type: ActivityType.LISTENING_TEST, config: { audioAssetId: 'audio1' } };
  const questions = [
    { id: 'q1', prompt: 'Where does she live?', answer: 'Paris', choices: ['Paris', 'London', 'Berlin', 'Rome'], order: 0 },
    { id: 'q2', prompt: 'How old is she?', answer: '30', choices: [], order: 1 },
  ];

  function makePrisma(exercise: { id: string; type: ActivityType; config: unknown }, items: object[]) {
    return {
      exercise: { findUnique: vi.fn().mockResolvedValue(exercise) },
      assignment: { findUnique: vi.fn().mockResolvedValue({ id: 'as1', studentId: 'student1', exerciseId: exercise.id }) },
      attempt: { create: vi.fn().mockResolvedValue({ id: 'att1' }), findUnique: vi.fn(), update: vi.fn(), count: vi.fn().mockResolvedValue(0) },
      itemBank: { findUnique: vi.fn().mockResolvedValue({ id: 'bank1', exerciseId: exercise.id, items }) },
      item: { findMany: vi.fn().mockResolvedValue(items) },
      itemResponse: { createMany: vi.fn() },
      skillProgress: { create: vi.fn() },
    };
  }
  function makeSvc(prisma: ReturnType<typeof makePrisma>): AttemptsService {
    return new AttemptsService(prisma as unknown as PrismaService, makeFakeAudit() as unknown as AuditService);
  }
  function inProgress(prisma: ReturnType<typeof makePrisma>, exercise: object, itemOrder: string[]) {
    prisma.attempt.findUnique.mockResolvedValue({ id: 'att1', studentId: 'student1', status: AttemptStatus.IN_PROGRESS, itemOrder, exercise });
    prisma.attempt.update.mockImplementation(({ data }: { data: object }) => Promise.resolve({ id: 'att1', ...data }));
  }

  describe('writing test', () => {
    const prompt = [{ id: 'p1', prompt: 'Describe your hometown.', answer: '', choices: [], order: 0 }];

    it('is one-shot: refuses to start without an assignment, and once one is submitted', async () => {
      const prisma = makePrisma(writing, prompt);
      await expect(makeSvc(prisma).start('student1', { exerciseId: 'wx' })).rejects.toThrow(/only be started from your assignments/);

      prisma.attempt.count.mockResolvedValue(1);
      await expect(makeSvc(prisma).start('student1', { exerciseId: 'wx', assignmentId: 'as1' })).rejects.toThrow(/already submitted/);
      expect(prisma.attempt.create).not.toHaveBeenCalled();
    });

    it('serves the prompt only', async () => {
      const result = await makeSvc(makePrisma(writing, prompt)).start('student1', { exerciseId: 'wx', assignmentId: 'as1' });
      expect(result.items).toEqual([{ id: 'p1', prompt: 'Describe your hometown.', choices: [] }]);
    });

    it('refuses a test that has no prompt', async () => {
      await expect(makeSvc(makePrisma(writing, [])).start('student1', { exerciseId: 'wx', assignmentId: 'as1' })).rejects.toThrow(/no prompt/);
    });

    it.each([
      ['an empty essay', '   ', /Write your answer/],
      ['an essay under the minimum', 'too short', /at least 3 words \(you have 2\)/],
      ['an essay over the maximum', 'one two three four five six seven', /at most 6 words \(you have 7\)/],
    ])('rejects %s and stores nothing', async (_name, essay, message) => {
      const prisma = makePrisma(writing, prompt);
      inProgress(prisma, writing, ['p1']);

      await expect(
        makeSvc(prisma).submit('att1', 'student1', { response: {}, itemResponses: [{ itemId: 'p1', given: essay }] }),
      ).rejects.toThrow(message);
      expect(prisma.itemResponse.createMany).not.toHaveBeenCalled();
    });

    it('stores the trimmed essay and leaves the attempt SUBMITTED and unscored', async () => {
      const prisma = makePrisma(writing, prompt);
      inProgress(prisma, writing, ['p1']);

      const result = await makeSvc(prisma).submit('att1', 'student1', {
        response: {},
        itemResponses: [{ itemId: 'p1', given: '  I live in a small town.  ' }],
      });

      expect(result).toMatchObject({ rawScore: null, status: AttemptStatus.SUBMITTED });
      expect(prisma.itemResponse.createMany).toHaveBeenCalledWith({
        data: [{ attemptId: 'att1', itemId: 'p1', given: 'I live in a small town.', order: 0 }],
      });
      expect(prisma.skillProgress.create).not.toHaveBeenCalled();
    });

    it('applies a ceiling even when the teacher set no maximum', async () => {
      const unbounded = { id: 'wx', type: ActivityType.WRITING_TEST, config: {} };
      const prisma = makePrisma(unbounded, prompt);
      inProgress(prisma, unbounded, ['p1']);

      await expect(
        makeSvc(prisma).submit('att1', 'student1', { response: {}, itemResponses: [{ itemId: 'p1', given: 'word '.repeat(5001) }] }),
      ).rejects.toThrow(/at most 5000 words/);
    });
  });

  describe('listening test', () => {
    it('is one-shot, like every teacher-controlled test', async () => {
      await expect(makeSvc(makePrisma(listening, questions)).start('student1', { exerciseId: 'lx' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('serves questions in authored order with the answer key stripped', async () => {
      const result = await makeSvc(makePrisma(listening, questions)).start('student1', { exerciseId: 'lx', assignmentId: 'as1' });

      expect(result.items!.map((i) => i.id)).toEqual(['q1', 'q2']);
      for (const item of result.items!) expect(item).not.toHaveProperty('answer');
      expect(result.exercise.config).toEqual({ audioAssetId: 'audio1' }); // the clip travels in config
    });

    it('serves the same choices, but never with the correct answer pinned in first place', async () => {
      // parseWordListText stores the answer first. With Math.random() = 0 the
      // shuffle rotates the list, so an unshuffled serve would still put
      // "Paris" first and this would fail.
      const random = vi.spyOn(Math, 'random').mockReturnValue(0);
      try {
        const result = await makeSvc(makePrisma(listening, questions)).start('student1', { exerciseId: 'lx', assignmentId: 'as1' });
        const choices = result.items![0]!.choices;
        expect([...choices].sort()).toEqual(['Berlin', 'London', 'Paris', 'Rome']);
        expect(choices[0]).not.toBe('Paris');
      } finally {
        random.mockRestore();
      }
    });

    it('scores each answer against the stored key and records SkillProgress as listening', async () => {
      const prisma = makePrisma(listening, questions);
      inProgress(prisma, listening, ['q1', 'q2']);

      const result = await makeSvc(prisma).submit('att1', 'student1', {
        response: {},
        itemResponses: [
          { itemId: 'q1', given: ' paris ' }, // right (case/whitespace-insensitive)
          { itemId: 'q2', given: '31' }, // wrong
        ],
      });

      expect(result).toMatchObject({ rawScore: 50, status: AttemptStatus.SCORED });
      expect(prisma.itemResponse.createMany).toHaveBeenCalledWith({
        data: [
          { attemptId: 'att1', itemId: 'q1', given: ' paris ', correct: true, order: 0 },
          { attemptId: 'att1', itemId: 'q2', given: '31', correct: false, order: 1 },
        ],
      });
      expect(prisma.skillProgress.create).toHaveBeenCalledWith({ data: { studentId: 'student1', skill: 'listening', score: 50 } });
    });
  });
});

describe('AttemptsService — vocabulary test bank mode', () => {
  it('shuffles MCQ choices at serve time so the stored answer-first order is not what students see', async () => {
    const exercise = { id: 'vx', type: ActivityType.VOCABULARY_TEST, config: { itemBankId: 'bank1', shuffleItems: false } };
    const items = [{ id: 'i1', prompt: 'big', answer: 'large', choices: ['large', 'tiny', 'red', 'fast'], mediaAssetId: null }];
    const prisma = makeFakePrisma();
    prisma.exercise.findUnique.mockResolvedValue(exercise);
    prisma.itemBank.findUnique.mockResolvedValue({ id: 'bank1', exerciseId: 'vx', items });
    prisma.attempt.create.mockResolvedValue({ id: 'att1' });

    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const result = await makeService(prisma, makeFakeAudit()).start('student1', { exerciseId: 'vx' });
      const choices = result.items![0]!.choices;
      expect([...choices].sort()).toEqual(['fast', 'large', 'red', 'tiny']);
      expect(choices[0]).not.toBe('large');
    } finally {
      random.mockRestore();
    }
  });
});

describe('AttemptsService.listAssignmentsForStudent — class labels', () => {
  const assignment = (id: string, teacherId: string) => ({
    id,
    teacherId,
    studentId: 'stu1',
    exerciseId: 'ex1',
    exercise: { id: 'ex1', title: 'Exercise' },
    teacher: { fullName: teacherId === 'tA' ? 'Teacher A' : 'Teacher B' },
  });
  const enrolment = (name: string, teacherIds: string[]) => ({ batch: { name, teachers: teacherIds.map((teacherId) => ({ teacherId })) } });

  function serviceFor(assignments: unknown[], enrollments: unknown[]): AttemptsService {
    const prisma = makeFakePrisma({
      assignment: { findMany: vi.fn().mockResolvedValue(assignments) },
      enrollment: { findMany: vi.fn().mockResolvedValue(enrollments) },
      attempt: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    return makeService(prisma, makeFakeAudit());
  }

  it('labels a row with the class name when the assigning teacher teaches exactly one of the student’s classes', async () => {
    const service = serviceFor([assignment('a1', 'tA')], [enrolment('Morning English', ['tA']), enrolment('Evening French', ['tB'])]);

    const [row] = await service.listAssignmentsForStudent('stu1');

    expect(row!.source).toEqual({ teacherName: 'Teacher A', className: 'Morning English' });
  });

  it('falls back to the teacher alone when that teacher teaches TWO of the student’s classes (ambiguous)', async () => {
    const service = serviceFor([assignment('a1', 'tA')], [enrolment('Morning English', ['tA']), enrolment('Evening English', ['tA'])]);

    const [row] = await service.listAssignmentsForStudent('stu1');

    expect(row!.source).toEqual({ teacherName: 'Teacher A', className: null });
  });

  it('falls back to the teacher alone when they no longer share any class with the student', async () => {
    const service = serviceFor([assignment('a1', 'tA')], [enrolment('Evening French', ['tB'])]);

    const [row] = await service.listAssignmentsForStudent('stu1');

    expect(row!.source).toEqual({ teacherName: 'Teacher A', className: null });
  });

  it('labels each row independently across several classes', async () => {
    const service = serviceFor(
      [assignment('a1', 'tA'), assignment('a2', 'tB')],
      [enrolment('Morning English', ['tA']), enrolment('Evening French', ['tB'])],
    );

    const rows = await service.listAssignmentsForStudent('stu1');

    expect(rows.map((r) => r.source.className)).toEqual(['Morning English', 'Evening French']);
  });

  it('uses the class the assignment was created from, even when the teacher shares two classes with the student', async () => {
    const service = serviceFor(
      [{ ...assignment('a1', 'tA'), batchId: 'b2', batch: { name: 'Evening English' } }],
      [enrolment('Morning English', ['tA']), enrolment('Evening English', ['tA'])],
    );

    const [row] = await service.listAssignmentsForStudent('stu1');

    expect(row!.source).toEqual({ teacherName: 'Teacher A', className: 'Evening English' });
    expect(row!.assignment).not.toHaveProperty('batch');
  });

  it('does not leak the joined teacher relation into the assignment payload', async () => {
    const service = serviceFor([assignment('a1', 'tA')], []);

    const [row] = await service.listAssignmentsForStudent('stu1');

    expect(row!.assignment).not.toHaveProperty('teacher');
    expect(row!.assignment).toMatchObject({ id: 'a1', teacherId: 'tA' });
  });
});
