import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ActivityType, AttemptStatus, MediaAssetScope, type CreateAssessmentDto } from '@lab/shared';
import { AssessmentsService } from './assessments.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { GradebookService } from '../gradebook/gradebook.service';
import type { BatchAccessService } from '../batches/batch-access.service';
import type { JwtPayload } from '../auth/auth.service';

const cuid = 'clh3am1r30000qzrmn831i7n';
const STUDENTS = ['clh3am1r30000qzrmn831i7a', 'clh3am1r30000qzrmn831i7b'];

/** A fake Prisma whose `$transaction` just runs the callback against itself,
 * which is enough to see what would be written — atomicity itself is the
 * database's job, not something a mock can prove. */
function makePrisma() {
  const prisma = {
    user: { findMany: vi.fn().mockResolvedValue(STUDENTS.map((id) => ({ id }))) },
    mediaAsset: { findUnique: vi.fn() },
    exercise: {
      create: vi.fn().mockResolvedValue({ id: 'ex1' }),
      update: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    itemBank: { create: vi.fn().mockResolvedValue({ id: 'bank1' }) },
    item: { createMany: vi.fn() },
    assignment: { createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    enrollment: { count: vi.fn().mockResolvedValue(STUDENTS.length) },
    attempt: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
  return prisma;
}

function makeSvc(prisma: ReturnType<typeof makePrisma>, gradebook = { override: vi.fn().mockResolvedValue({ newScore: 80 }) }) {
  const audit = { log: vi.fn() };
  const batchAccess = { assertCanUseBatch: vi.fn().mockResolvedValue(undefined) };
  return {
    svc: new AssessmentsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      gradebook as unknown as GradebookService,
      batchAccess as unknown as BatchAccessService,
    ),
    gradebook,
    audit,
    batchAccess,
  };
}

const TEACHER_USER: JwtPayload = { sub: 'teacher1', role: 'TEACHER', serviceNumber: 'TCH-1' };

const teacher = { id: 'teacher1', role: 'TEACHER' };

describe('AssessmentsService.create', () => {
  const vocab = (over: Partial<Extract<CreateAssessmentDto, { type: 'VOCABULARY_TEST' }>> = {}): CreateAssessmentDto => ({
    type: ActivityType.VOCABULARY_TEST,
    title: 'Unit 3 words',
    studentIds: STUDENTS,
    wordListText: 'cat = gato\ndog = perro | gato | pez',
    ...over,
  });

  it('vocabulary: creates the exercise, its bank and items, points the config at the bank, and assigns every student', async () => {
    const prisma = makePrisma();
    const dueAt = new Date('2026-10-01');
    const { svc, audit } = makeSvc(prisma);

    const result = await svc.create(TEACHER_USER, vocab({ dueAt }));

    expect(result).toEqual({ exerciseId: 'ex1', type: ActivityType.VOCABULARY_TEST, questionCount: 2, assigned: 2 });
    expect(prisma.item.createMany).toHaveBeenCalledWith({
      data: [
        { itemBankId: 'bank1', order: 0, type: 'SHORT_ANSWER', prompt: 'cat', answer: 'gato', choices: [], mediaAssetId: null },
        { itemBankId: 'bank1', order: 1, type: 'MCQ', prompt: 'dog', answer: 'perro', choices: ['perro', 'gato', 'pez'], mediaAssetId: null },
      ],
    });
    expect(prisma.exercise.update).toHaveBeenCalledWith({
      where: { id: 'ex1' },
      data: { config: { itemBankId: 'bank1', shuffleItems: true } },
    });
    expect(prisma.assignment.createMany).toHaveBeenCalledWith({
      data: STUDENTS.map((studentId) => ({ teacherId: 'teacher1', studentId, exerciseId: 'ex1', dueAt })),
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'assessment.create' }));
  });

  it('vocabulary: keeps sampleSize only when it is smaller than the bank', async () => {
    const small = makePrisma();
    await makeSvc(small).svc.create(TEACHER_USER, vocab({ sampleSize: 1 }));
    expect(small.exercise.update).toHaveBeenCalledWith(expect.objectContaining({ data: { config: { itemBankId: 'bank1', shuffleItems: true, sampleSize: 1 } } }));

    const big = makePrisma();
    await makeSvc(big).svc.create(TEACHER_USER, vocab({ sampleSize: 50 }));
    expect(big.exercise.update).toHaveBeenCalledWith(expect.objectContaining({ data: { config: { itemBankId: 'bank1', shuffleItems: true } } }));
  });

  it('turns a malformed question list into a 400 that names the bad line, and writes nothing', async () => {
    const prisma = makePrisma();
    const { svc } = makeSvc(prisma);

    await expect(svc.create(TEACHER_USER, vocab({ wordListText: 'cat = gato\nthis line has no equals' }))).rejects.toThrow(/missing "="/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses inactive or unknown students without creating anything', async () => {
    const prisma = makePrisma();
    prisma.user.findMany.mockResolvedValue([{ id: STUDENTS[0] }]); // the second one isn't an active student
    const { svc } = makeSvc(prisma);

    await expect(svc.create(TEACHER_USER, vocab())).rejects.toThrow(/Not active students: clh3am1r30000qzrmn831i7b/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('only assigns each student once even if they are listed twice', async () => {
    const prisma = makePrisma();
    prisma.user.findMany.mockResolvedValue([{ id: STUDENTS[0] }]);
    const { svc } = makeSvc(prisma);

    const result = await svc.create(TEACHER_USER, vocab({ studentIds: [STUDENTS[0]!, STUDENTS[0]!] }));

    expect(result.assigned).toBe(1);
  });

  it('refuses more questions than the cap', async () => {
    const lines = Array.from({ length: 201 }, (_, i) => `q${i} = a${i}`).join('\n');
    await expect(makeSvc(makePrisma()).svc.create(TEACHER_USER, vocab({ wordListText: lines }))).rejects.toThrow(/At most 200 questions/);
  });

  describe('created from a class', () => {
    const CLASS_ID = 'clh3am1r30000qzrmn831c1a';

    it('checks the teacher teaches the class and files every assignment under it', async () => {
      const prisma = makePrisma();
      const { svc, batchAccess } = makeSvc(prisma);

      await svc.create(TEACHER_USER, vocab({ batchId: CLASS_ID }));

      expect(batchAccess.assertCanUseBatch).toHaveBeenCalledWith(TEACHER_USER, CLASS_ID);
      expect(prisma.enrollment.count).toHaveBeenCalledWith({ where: { batchId: CLASS_ID, userId: { in: STUDENTS } } });
      const rows = prisma.assignment.createMany.mock.calls[0]![0].data as Array<{ batchId?: string }>;
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.batchId === CLASS_ID)).toBe(true);
    });

    it('refuses a student who is not in the class, writing nothing', async () => {
      const prisma = makePrisma();
      prisma.enrollment.count.mockResolvedValue(1);
      const { svc } = makeSvc(prisma);

      await expect(svc.create(TEACHER_USER, vocab({ batchId: CLASS_ID }))).rejects.toThrow(/not in this class/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses a class the teacher does not teach', async () => {
      const prisma = makePrisma();
      const { svc, batchAccess } = makeSvc(prisma);
      batchAccess.assertCanUseBatch.mockRejectedValue(new ForbiddenException('You are not assigned to this batch'));

      await expect(svc.create(TEACHER_USER, vocab({ batchId: CLASS_ID }))).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('leaves batchId unset when not created from a class', async () => {
      const prisma = makePrisma();
      const { svc, batchAccess } = makeSvc(prisma);

      await svc.create(TEACHER_USER, vocab());

      expect(batchAccess.assertCanUseBatch).not.toHaveBeenCalled();
      const rows = prisma.assignment.createMany.mock.calls[0]![0].data as Array<{ batchId?: string }>;
      expect(rows.every((r) => r.batchId === undefined)).toBe(true);
    });
  });

  describe('writing test', () => {
    const writing = (over: object = {}): CreateAssessmentDto =>
      ({ type: ActivityType.WRITING_TEST, title: 'Hometown', studentIds: STUDENTS, prompt: 'Describe your hometown.', ...over }) as CreateAssessmentDto;

    it('stores the prompt as the single bank item with no answer key, and the limits as config', async () => {
      const prisma = makePrisma();
      await makeSvc(prisma).svc.create(TEACHER_USER, writing({ instructions: 'Use full sentences.', minWords: 50, maxWords: 120 }));

      expect(prisma.item.createMany).toHaveBeenCalledWith({
        data: [{ itemBankId: 'bank1', order: 0, type: 'SHORT_ANSWER', prompt: 'Describe your hometown.', answer: '', choices: [], mediaAssetId: null }],
      });
      expect(prisma.exercise.update).toHaveBeenCalledWith({
        where: { id: 'ex1' },
        data: { config: { instructions: 'Use full sentences.', minWords: 50, maxWords: 120 } },
      });
    });

    it('rejects a minimum above the maximum before touching the database', async () => {
      const prisma = makePrisma();
      await expect(makeSvc(prisma).svc.create(TEACHER_USER, writing({ minWords: 300, maxWords: 100 }))).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('listening test', () => {
    const listening = (): CreateAssessmentDto => ({
      type: ActivityType.LISTENING_TEST,
      title: 'Airport announcement',
      studentIds: STUDENTS,
      audioAssetId: cuid,
      questionsText: 'Which gate? = B12 | A4 | C9',
    });

    it('accepts a shared audio clip and keeps it in the config', async () => {
      const prisma = makePrisma();
      prisma.mediaAsset.findUnique.mockResolvedValue({ kind: 'audio', scope: MediaAssetScope.INSTITUTION });

      await makeSvc(prisma).svc.create(TEACHER_USER, listening());

      expect(prisma.exercise.update).toHaveBeenCalledWith({ where: { id: 'ex1' }, data: { config: { audioAssetId: cuid } } });
      expect(prisma.item.createMany).toHaveBeenCalledWith({
        data: [{ itemBankId: 'bank1', order: 0, type: 'MCQ', prompt: 'Which gate?', answer: 'B12', choices: ['B12', 'A4', 'C9'], mediaAssetId: null }],
      });
    });

    it('refuses a PRIVATE clip — students could not play it, and it must not be widened silently', async () => {
      const prisma = makePrisma();
      prisma.mediaAsset.findUnique.mockResolvedValue({ kind: 'audio', scope: MediaAssetScope.PRIVATE });

      await expect(makeSvc(prisma).svc.create(TEACHER_USER, listening())).rejects.toThrow(/private/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses a file that is not audio, and one that does not exist', async () => {
      const prisma = makePrisma();
      prisma.mediaAsset.findUnique.mockResolvedValue({ kind: 'video', scope: MediaAssetScope.INSTITUTION });
      await expect(makeSvc(prisma).svc.create(TEACHER_USER, listening())).rejects.toThrow(/not audio/);

      prisma.mediaAsset.findUnique.mockResolvedValue(null);
      await expect(makeSvc(prisma).svc.create(TEACHER_USER, listening())).rejects.toThrow(/not found/);
    });
  });

  describe('reading test', () => {
    const reading = (over: object = {}): CreateAssessmentDto =>
      ({ type: ActivityType.READING_TEST, title: 'Read aloud', studentIds: STUDENTS, passage: 'The quick brown fox.', ...over }) as CreateAssessmentDto;

    it('stores the passage as the single bank item with no answer key, and the voice as config', async () => {
      const prisma = makePrisma();
      await makeSvc(prisma).svc.create(TEACHER_USER, reading({ instructions: 'Read clearly.', voice: 'en_US' }));

      expect(prisma.item.createMany).toHaveBeenCalledWith({
        data: [{ itemBankId: 'bank1', order: 0, type: 'SHORT_ANSWER', prompt: 'The quick brown fox.', answer: '', choices: [], mediaAssetId: null }],
      });
      expect(prisma.exercise.update).toHaveBeenCalledWith({
        where: { id: 'ex1' },
        data: { config: { instructions: 'Read clearly.', voice: 'en_US' } },
      });
    });

    it('defaults the voice to en_GB when the teacher does not pick one', async () => {
      const prisma = makePrisma();
      await makeSvc(prisma).svc.create(TEACHER_USER, reading());
      expect(prisma.exercise.update).toHaveBeenCalledWith({
        where: { id: 'ex1' },
        data: { config: { instructions: undefined, voice: 'en_GB' } },
      });
    });

    it('accepts a shared PDF instead of typed text, storing it as the item’s mediaAssetId with an empty prompt', async () => {
      const prisma = makePrisma();
      prisma.mediaAsset.findUnique.mockResolvedValue({ mimeType: 'application/pdf', scope: MediaAssetScope.INSTITUTION });

      await makeSvc(prisma).svc.create(TEACHER_USER, reading({ passage: undefined, documentAssetId: cuid }));

      expect(prisma.mediaAsset.findUnique).toHaveBeenCalledWith({ where: { id: cuid }, select: { mimeType: true, scope: true } });
      expect(prisma.item.createMany).toHaveBeenCalledWith({
        data: [{ itemBankId: 'bank1', order: 0, type: 'SHORT_ANSWER', prompt: '', answer: '', choices: [], mediaAssetId: cuid }],
      });
    });

    it('accepts both a typed passage and an uploaded PDF together', async () => {
      const prisma = makePrisma();
      prisma.mediaAsset.findUnique.mockResolvedValue({ mimeType: 'application/pdf', scope: MediaAssetScope.INSTITUTION });

      await makeSvc(prisma).svc.create(TEACHER_USER, reading({ documentAssetId: cuid }));

      expect(prisma.item.createMany).toHaveBeenCalledWith({
        data: [{ itemBankId: 'bank1', order: 0, type: 'SHORT_ANSWER', prompt: 'The quick brown fox.', answer: '', choices: [], mediaAssetId: cuid }],
      });
    });

    it('refuses a test with neither a passage nor a document, writing nothing', async () => {
      const prisma = makePrisma();
      await expect(makeSvc(prisma).svc.create(TEACHER_USER, reading({ passage: undefined }))).rejects.toThrow(/passage to type, or upload a PDF/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses a PRIVATE document — students could not open it, and it must not be widened silently', async () => {
      const prisma = makePrisma();
      prisma.mediaAsset.findUnique.mockResolvedValue({ mimeType: 'application/pdf', scope: MediaAssetScope.PRIVATE });

      await expect(makeSvc(prisma).svc.create(TEACHER_USER, reading({ documentAssetId: cuid }))).rejects.toThrow(/private/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses a file that is not a PDF, and one that does not exist', async () => {
      const prisma = makePrisma();
      prisma.mediaAsset.findUnique.mockResolvedValue({ mimeType: 'audio/mpeg', scope: MediaAssetScope.INSTITUTION });
      await expect(makeSvc(prisma).svc.create(TEACHER_USER, reading({ documentAssetId: cuid }))).rejects.toThrow(/not a PDF/);

      prisma.mediaAsset.findUnique.mockResolvedValue(null);
      await expect(makeSvc(prisma).svc.create(TEACHER_USER, reading({ documentAssetId: cuid }))).rejects.toThrow(/not found/);
    });
  });
});

describe('AssessmentsService.list', () => {
  it('rejects a type that is not one of the assignment types', async () => {
    await expect(makeSvc(makePrisma()).svc.list(teacher, ActivityType.PRONUNCIATION)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("scopes a teacher to their own assignments, but an admin sees everyone's", async () => {
    const prisma = makePrisma();
    prisma.exercise.findMany.mockResolvedValue([]);
    const { svc } = makeSvc(prisma);

    await svc.list(teacher, ActivityType.WRITING_TEST);
    expect(prisma.exercise.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { type: ActivityType.WRITING_TEST, assignments: { some: {} }, teacherId: 'teacher1' } }),
    );

    await svc.list({ id: 'admin1', role: 'ADMIN' }, ActivityType.WRITING_TEST);
    expect(prisma.exercise.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { type: ActivityType.WRITING_TEST, assignments: { some: {} } } }),
    );
  });

  it('counts submissions, essays still to mark, and averages each student’s latest scored attempt', async () => {
    const prisma = makePrisma();
    const attempt = (status: string, rawScore: number | null) => ({ status, rawScore, maxScore: 100 });
    prisma.exercise.findMany.mockResolvedValue([
      {
        id: 'ex1',
        type: ActivityType.WRITING_TEST,
        title: 'Hometown',
        createdAt: new Date(),
        teacher: { fullName: 'T' },
        itemBank: { _count: { items: 1 } },
        assignments: [
          { id: 'a1', attempts: [attempt(AttemptStatus.SCORED, 80)] },
          { id: 'a2', attempts: [attempt(AttemptStatus.SUBMITTED, null)] }, // waiting to be marked
          { id: 'a3', attempts: [attempt(AttemptStatus.IN_PROGRESS, null)] }, // opened, not handed in
          { id: 'a4', attempts: [] },
        ],
      },
    ]);

    const [row] = await makeSvc(prisma).svc.list(teacher, ActivityType.WRITING_TEST);

    expect(row).toMatchObject({ assigned: 4, submitted: 2, toGrade: 1, averageScore: 80, questionCount: 1 });
  });
});

describe('AssessmentsService.get', () => {
  const exercise = (type: ActivityType, teacherId = 'teacher1') => ({
    id: 'ex1',
    type,
    title: 'T',
    createdAt: new Date(),
    teacherId,
    config: {},
    teacher: { fullName: 'Teacher One' },
    itemBank: { items: [{ id: 'q1', prompt: 'Prompt', answer: 'secret', choices: [], order: 0 }] },
  });

  it('does not ship an answer key for a writing prompt or a reading passage, but does for a self-scoring test', async () => {
    const prisma = makePrisma();
    const { svc } = makeSvc(prisma);

    prisma.exercise.findUnique.mockResolvedValue(exercise(ActivityType.WRITING_TEST));
    expect((await svc.get('ex1', teacher)).questions[0]!.answer).toBeNull();

    prisma.exercise.findUnique.mockResolvedValue(exercise(ActivityType.READING_TEST));
    expect((await svc.get('ex1', teacher)).questions[0]!.answer).toBeNull();

    prisma.exercise.findUnique.mockResolvedValue(exercise(ActivityType.LISTENING_TEST));
    expect((await svc.get('ex1', teacher)).questions[0]!.answer).toBe('secret');
  });

  it("refuses another teacher's assignment (it holds students' essays) but lets an admin in", async () => {
    const prisma = makePrisma();
    prisma.exercise.findUnique.mockResolvedValue(exercise(ActivityType.WRITING_TEST, 'someone-else'));
    const { svc } = makeSvc(prisma);

    await expect(svc.get('ex1', teacher)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.get('ex1', { id: 'admin1', role: 'ADMIN' })).resolves.toMatchObject({ id: 'ex1' });
  });

  it('404s for an exercise that is not one of the assignment types', async () => {
    const prisma = makePrisma();
    prisma.exercise.findUnique.mockResolvedValue(exercise(ActivityType.PRONUNCIATION_TEST));
    await expect(makeSvc(prisma).svc.get('ex1', teacher)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("shows each student's latest finished attempt, with their essay as `given`", async () => {
    const prisma = makePrisma();
    prisma.exercise.findUnique.mockResolvedValue(exercise(ActivityType.WRITING_TEST));
    prisma.assignment.findMany.mockResolvedValue([{ id: 'a1', dueAt: null, student: { id: 's1', fullName: 'Asha', serviceNumber: '2301' } }]);
    prisma.attempt.findMany.mockResolvedValue([
      // newest first, as the query orders them
      { id: 'att2', assignmentId: 'a1', status: AttemptStatus.IN_PROGRESS, rawScore: null, maxScore: 100, submittedAt: null, itemResponses: [], scoreOverride: null },
      {
        id: 'att1',
        assignmentId: 'a1',
        status: AttemptStatus.SUBMITTED,
        rawScore: null,
        maxScore: 100,
        submittedAt: new Date(),
        itemResponses: [{ itemId: 'q1', given: 'My essay.', correct: null }],
        scoreOverride: null,
      },
    ]);

    const result = await makeSvc(prisma).svc.get('ex1', teacher);

    expect(result.assignments[0]!.attempt).toMatchObject({ id: 'att1', responses: [{ itemId: 'q1', given: 'My essay.' }] });
  });
});

describe('AssessmentsService.grade', () => {
  const attempt = (over: object = {}) => ({
    id: 'att1',
    status: AttemptStatus.SUBMITTED,
    exercise: { type: ActivityType.WRITING_TEST, teacherId: 'teacher1' },
    ...over,
  });

  it('sends the mark and the teacher’s feedback through the gradebook override', async () => {
    const prisma = makePrisma();
    prisma.attempt.findUnique.mockResolvedValue(attempt());
    const { svc, gradebook } = makeSvc(prisma);

    await svc.grade(teacher, 'att1', { score: 72, feedback: 'Good structure.' });

    expect(gradebook.override).toHaveBeenCalledWith('teacher1', { attemptId: 'att1', newScore: 72, reason: 'Good structure.' });
  });

  it('supplies a placeholder reason when the teacher writes no feedback (the override requires one)', async () => {
    const prisma = makePrisma();
    prisma.attempt.findUnique.mockResolvedValue(attempt());
    const { svc, gradebook } = makeSvc(prisma);

    await svc.grade(teacher, 'att1', { score: 72 });

    expect(gradebook.override).toHaveBeenCalledWith('teacher1', expect.objectContaining({ reason: expect.stringMatching(/\S/) }));
  });

  it('also accepts a reading test — the other hand-marked type', async () => {
    const prisma = makePrisma();
    prisma.attempt.findUnique.mockResolvedValue(attempt({ exercise: { type: ActivityType.READING_TEST, teacherId: 'teacher1' } }));
    const { svc, gradebook } = makeSvc(prisma);

    await svc.grade(teacher, 'att1', { score: 90, feedback: 'Clear and well-paced.' });

    expect(gradebook.override).toHaveBeenCalledWith('teacher1', { attemptId: 'att1', newScore: 90, reason: 'Clear and well-paced.' });
  });

  it.each([
    ['a test that scores itself', attempt({ exercise: { type: ActivityType.LISTENING_TEST, teacherId: 'teacher1' } }), BadRequestException],
    ['an essay not handed in yet', attempt({ status: AttemptStatus.IN_PROGRESS }), BadRequestException],
    ["another teacher's assignment", attempt({ exercise: { type: ActivityType.WRITING_TEST, teacherId: 'someone-else' } }), ForbiddenException],
  ])('refuses %s', async (_name, found, error) => {
    const prisma = makePrisma();
    prisma.attempt.findUnique.mockResolvedValue(found);
    const { svc, gradebook } = makeSvc(prisma);

    await expect(svc.grade(teacher, 'att1', { score: 50 })).rejects.toBeInstanceOf(error);
    expect(gradebook.override).not.toHaveBeenCalled();
  });

  it('404s for an unknown attempt', async () => {
    const prisma = makePrisma();
    prisma.attempt.findUnique.mockResolvedValue(null);
    await expect(makeSvc(prisma).svc.grade(teacher, 'nope', { score: 50 })).rejects.toBeInstanceOf(NotFoundException);
  });
});
