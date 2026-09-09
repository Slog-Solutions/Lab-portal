import type { PrismaClient } from '../generated/prisma';

/**
 * Phase 4 — Ser 4/10's "Grade-wise, level-wise... content" and
 * "CEFR-aligned worksheets across 4 key skills" rows. The build plan's
 * "known gaps" note is explicit that no third-party courseware
 * (Britannica, "Rhythm from Rain Land", a purchased 600-item bank) ships
 * with this system — licensing that content was never this project's to
 * decide — so this is a small **originally authored** seed pack instead,
 * proving the CEFR engine (Curriculum → Unit → Lesson → Exercise,
 * StudyModule bundling) with real content rather than leaving it schema-only.
 *
 * Three levels (A1/A2/B1) × four skills (Listening/Speaking/Reading/
 * Grammar) — deliberately small and hand-written, not "the" curriculum a
 * real deployment would use. Extending to A1-C2 or importing a licensed
 * bank is the same shape of work (this same StudyModule/Curriculum
 * machinery), not a rework.
 *
 * Listening items are text-transcript-based, not audio-based: the offline
 * eSpeak-NG/Piper pipeline that could generate real listening audio isn't
 * vendored on this dev box (same honest degradation Phase 3's
 * PronunciationService already documents), and Item.mediaAssetId — wired
 * through to the player this same pass (attempts.service.ts's ServedItem,
 * VocabularyTestPlayer's ItemAudio) — is exactly the mechanism a real
 * deployment would use to attach real listening audio per item; this pack
 * just doesn't populate it, honestly, rather than faking silence as audio.
 */

interface SkillContent {
  grammar: Array<{ prompt: string; answer: string }>;
  reading: { passage: string; questions: Array<{ prompt: string; answer: string }> };
  speaking: string; // PRONUNCIATION sourceText
  listening: { transcript: string; questions: Array<{ prompt: string; answer: string }> };
}

const LEVELS: Record<'A1' | 'A2' | 'B1', SkillContent> = {
  A1: {
    grammar: [
      { prompt: 'I ___ a student. (be)', answer: 'am' },
      { prompt: 'She ___ to school every day. (go)', answer: 'goes' },
      { prompt: 'They ___ happy today. (be)', answer: 'are' },
      { prompt: 'He ___ a small dog. (have)', answer: 'has' },
      { prompt: 'We ___ from India. (be)', answer: 'are' },
    ],
    reading: {
      passage:
        'My name is Meera. I live in Bangalore. I have one brother and one sister. Every morning I wake up at six o\'clock. I go to school by bus.',
      questions: [
        { prompt: 'What is the person\'s name?', answer: 'Meera' },
        { prompt: 'Where does she live?', answer: 'Bangalore' },
        { prompt: 'How many siblings does she have?', answer: 'two' },
        { prompt: 'What time does she wake up?', answer: 'six o\'clock' },
        { prompt: 'How does she go to school?', answer: 'by bus' },
      ],
    },
    speaking: 'Good morning. My name is Arjun. Nice to meet you.',
    listening: {
      transcript: 'The train leaves at nine o\'clock from platform two.',
      questions: [
        { prompt: 'Listen: "The train leaves at nine o\'clock from platform two." What time does the train leave?', answer: 'nine o\'clock' },
        { prompt: 'Which platform does the train leave from?', answer: 'platform two' },
      ],
    },
  },
  A2: {
    grammar: [
      { prompt: 'If it rains tomorrow, I ___ at home. (stay)', answer: 'will stay' },
      { prompt: 'She has ___ here since 2019. (live)', answer: 'lived' },
      { prompt: 'You ___ wear a seatbelt in the car. (must)', answer: 'must' },
      { prompt: 'He ___ spicy food. (not like)', answer: "doesn't like" },
      { prompt: 'We ___ our homework already. (finish)', answer: 'have already finished' },
    ],
    reading: {
      passage:
        'Ravi works at a small bakery in the city. He starts work at five in the morning and bakes fresh bread for the shop. On Sundays, the bakery is closed, and Ravi likes to visit his grandmother in the village.',
      questions: [
        { prompt: 'Where does Ravi work?', answer: 'a bakery' },
        { prompt: 'What time does he start work?', answer: 'five in the morning' },
        { prompt: 'What does he bake?', answer: 'bread' },
        { prompt: 'When is the bakery closed?', answer: 'Sundays' },
        { prompt: 'What does Ravi do on Sundays?', answer: 'visit his grandmother' },
      ],
    },
    speaking: 'Could you please tell me how to get to the railway station from here?',
    listening: {
      transcript: 'Attention passengers, the 10:15 bus to the cantonment area has been delayed by twenty minutes.',
      questions: [
        { prompt: 'Listen: "The 10:15 bus to the cantonment area has been delayed by twenty minutes." How long is the delay?', answer: 'twenty minutes' },
        { prompt: 'Where is the delayed bus going?', answer: 'the cantonment area' },
      ],
    },
  },
  B1: {
    grammar: [
      { prompt: 'By the time we arrived, the meeting ___. (already start)', answer: 'had already started' },
      { prompt: 'I wish I ___ the answer earlier. (know)', answer: 'had known' },
      { prompt: 'The report ___ by the manager tomorrow. (submit, passive)', answer: 'will be submitted' },
      { prompt: 'Despite ___ tired, she finished the assignment. (feel)', answer: 'feeling' },
      { prompt: 'He suggested that she ___ for the scholarship. (apply)', answer: 'apply' },
    ],
    reading: {
      passage:
        'The regional library recently introduced a digital lending scheme that allows members to borrow e-books directly from their phones. Within the first month, over three hundred readers had registered for the service, and librarians report that young adults make up the largest group of new users.',
      questions: [
        { prompt: 'What new scheme did the library introduce?', answer: 'digital lending / e-book borrowing' },
        { prompt: 'How many readers registered in the first month?', answer: 'over three hundred' },
        { prompt: 'Which group of users is largest?', answer: 'young adults' },
      ],
    },
    speaking: 'The committee has decided to postpone the annual meeting until further notice, due to unforeseen circumstances.',
    listening: {
      transcript: 'Due to scheduled maintenance, the online portal will be unavailable between 11 PM and 3 AM tonight.',
      questions: [
        { prompt: 'Listen: "The online portal will be unavailable between 11 PM and 3 AM tonight." When will the portal be unavailable?', answer: '11 PM to 3 AM' },
        { prompt: 'Why will the portal be unavailable?', answer: 'scheduled maintenance' },
      ],
    },
  },
};

/** Mirrors the real authoring flow's two-step "create inline, then
 * upgrade to bank mode" dance (ExerciseDetailPage's enableBank mutation)
 * rather than writing the final config directly — ItemBank.exerciseId is
 * a real FK, so the Exercise row has to exist first either way. */
async function createBankVocabExercise(
  prisma: PrismaClient,
  teacherId: string,
  lessonId: string,
  title: string,
  cefrTag: string,
  items: Array<{ prompt: string; answer: string }>,
): Promise<string> {
  const exercise = await prisma.exercise.create({
    data: {
      teacherId,
      lessonId,
      type: 'VOCABULARY_TEST',
      title,
      config: { items: [{ prompt: items[0]!.prompt, answer: items[0]!.answer }], shuffleItems: true },
    },
  });
  const bank = await prisma.itemBank.create({ data: { exerciseId: exercise.id } });
  await prisma.item.createMany({
    data: items.map((item, order) => ({ itemBankId: bank.id, order, prompt: item.prompt, answer: item.answer, cefrTag })),
  });
  await prisma.exercise.update({
    where: { id: exercise.id },
    data: { config: { itemBankId: bank.id, sampleSize: items.length, shuffleItems: true } },
  });
  return exercise.id;
}

export async function seedCefrContent(prisma: PrismaClient, teacherId: string): Promise<void> {
  for (const [level, content] of Object.entries(LEVELS) as Array<[keyof typeof LEVELS, SkillContent]>) {
    const curriculumId = `seedcefr${level.toLowerCase()}01`;
    await prisma.curriculum.upsert({
      where: { id: curriculumId },
      update: {},
      create: { id: curriculumId, title: `CEFR ${level} — Original Seed Pack`, cefrLevel: level, ownerId: teacherId },
    });

    const skillDefs: Array<{ key: string; title: string; order: number }> = [
      { key: 'listening', title: 'Listening', order: 1 },
      { key: 'speaking', title: 'Speaking', order: 2 },
      { key: 'reading', title: 'Reading', order: 3 },
      { key: 'grammar', title: 'Grammar', order: 4 },
    ];

    const exerciseIds: string[] = [];
    for (const skill of skillDefs) {
      const unitId = `seedcefr${level.toLowerCase()}${skill.key}u`;
      await prisma.unit.upsert({
        where: { id: unitId },
        update: {},
        create: { id: unitId, curriculumId, title: skill.title, order: skill.order },
      });
      const lessonId = `seedcefr${level.toLowerCase()}${skill.key}l`;
      await prisma.lesson.upsert({
        where: { id: lessonId },
        update: {},
        create: { id: lessonId, unitId, title: `${skill.title} Practice`, order: 1 },
      });

      // Idempotent across repeated `prisma db seed` runs: skip if this
      // lesson already has an exercise from a prior run rather than
      // duplicating it (Exercise has no natural unique key to upsert on).
      const existing = await prisma.exercise.findFirst({ where: { lessonId } });
      if (existing) {
        exerciseIds.push(existing.id);
        continue;
      }

      if (skill.key === 'speaking') {
        const exercise = await prisma.exercise.create({
          data: {
            teacherId,
            lessonId,
            type: 'PRONUNCIATION',
            title: `${level} Speaking Practice`,
            config: { sourceText: content.speaking, voice: 'en_GB' },
          },
        });
        exerciseIds.push(exercise.id);
      } else if (skill.key === 'reading') {
        const items = content.reading.questions.map((q) => ({ prompt: `${content.reading.passage}\n\n${q.prompt}`, answer: q.answer }));
        exerciseIds.push(await createBankVocabExercise(prisma, teacherId, lessonId, `${level} Reading Comprehension`, level, items));
      } else if (skill.key === 'listening') {
        exerciseIds.push(
          await createBankVocabExercise(prisma, teacherId, lessonId, `${level} Listening Comprehension`, level, content.listening.questions),
        );
      } else {
        exerciseIds.push(await createBankVocabExercise(prisma, teacherId, lessonId, `${level} Grammar Drill`, level, content.grammar));
      }
    }

    await prisma.studyModule.upsert({
      where: { id: `seedcefr${level.toLowerCase()}mod` },
      update: { exerciseIds },
      create: { id: `seedcefr${level.toLowerCase()}mod`, title: `CEFR ${level} — All Skills`, exerciseIds },
    });
  }
}
