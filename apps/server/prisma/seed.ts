import { PrismaClient } from '../generated/prisma';
import { AuthService } from '../src/modules/auth/auth.service';
import { seedCefrContent } from './seed-cefr-content';

/**
 * Seeds exactly one clean test dataset to exercise Phase 0 end to end:
 * one admin, three teachers, one batch, and 40 student users pre-enrolled
 * — matching the 40-student-seat shape from Annexure-I so tools/sim
 * (Phase 1) can drive a realistic load test without further fixture work.
 *
 * Meant to be the ONLY data in a dev database: run against a database
 * that has just been through `prisma migrate reset` (drops + recreates
 * every table) rather than layered on top of whatever testing debris
 * accumulated previously — this script is idempotent (upsert-based) but
 * does not delete unrelated rows (sessions, stations, ad hoc exercises,
 * attempts) created outside of it.
 */
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const adminPasswordHash = await AuthService.hashPassword('Admin@12345');
  const admin = await prisma.user.upsert({
    where: { serviceNumber: 'ADMIN-001' },
    update: {},
    create: {
      serviceNumber: 'ADMIN-001',
      fullName: 'Lab Administrator',
      role: 'ADMIN',
      passwordHash: adminPasswordHash,
    },
  });

  const teacherPasswordHash = await AuthService.hashPassword('Teacher@12345');
  const teacherSeeds = [
    { serviceNumber: 'TCH-001', fullName: 'R.S. Shekhawat', rank: 'Lt Col' },
    { serviceNumber: 'TCH-002', fullName: 'A.K. Mehta', rank: 'Maj' },
    { serviceNumber: 'TCH-003', fullName: 'P. Iyer', rank: 'Capt' },
  ];
  const teachers = [];
  for (const t of teacherSeeds) {
    teachers.push(
      await prisma.user.upsert({
        where: { serviceNumber: t.serviceNumber },
        update: {},
        create: {
          serviceNumber: t.serviceNumber,
          fullName: t.fullName,
          rank: t.rank,
          role: 'TEACHER',
          passwordHash: teacherPasswordHash,
        },
      }),
    );
  }
  // CEFR content pack is owned by the first teacher; the batch is shared
  // by all three (any teacher can start a ClassSession against any batch
  // — see sessions.service.ts's listBatches — so one shared cohort is
  // enough to test all three teacher logins against the same 40 students).
  const teacher = teachers[0]!;

  const batch = await prisma.batch.upsert({
    // Hyphen-free: every API DTO validates IDs against a cuid2-shaped
    // pattern ([0-9a-z]+, no hyphens) to match Prisma's own @default(cuid())
    // output, so a hand-picked seed ID has to satisfy that too.
    where: { id: 'seedbatchactc01' },
    update: {},
    create: { id: 'seedbatchactc01', name: 'ACTC Batch 01' },
  });

  const studentPasswordHash = await AuthService.hashPassword('Student@12345');
  for (let i = 1; i <= 40; i++) {
    const serviceNumber = `STU-${String(i).padStart(3, '0')}`;
    const student = await prisma.user.upsert({
      where: { serviceNumber },
      update: {},
      create: {
        serviceNumber,
        fullName: `Trainee ${i}`,
        role: 'STUDENT',
        passwordHash: studentPasswordHash,
      },
    });
    await prisma.enrollment.upsert({
      where: { userId_batchId: { userId: student.id, batchId: batch.id } },
      update: {},
      create: { userId: student.id, batchId: batch.id },
    });
  }

  // Phase 4 — original CEFR seed pack (Ser 4/10), owned by the seeded
  // teacher so it shows up in their own Exercises/Study Library pages
  // exactly like anything they'd author themselves.
  await seedCefrContent(prisma, teacher.id);

  // eslint-disable-next-line no-console
  console.log(
    `Seeded: admin=${admin.serviceNumber} teachers=${teachers.map((t) => t.serviceNumber).join(',')} batch=${batch.name} + 40 students`,
  );
  // eslint-disable-next-line no-console
  console.log('Seeded: CEFR A1/A2/B1 original content pack (Listening/Speaking/Reading/Grammar) + Study Library modules');
  // eslint-disable-next-line no-console
  console.log('Default passwords: Admin@12345 / Teacher@12345 / Student@12345 — rotate before any real deployment.');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
