import { PrismaClient } from '../generated/prisma';
import { AuthService } from '../src/modules/auth/auth.service';

/**
 * Seeds enough data to exercise Phase 0 end to end: one admin, one
 * teacher, one batch, and 40 student users pre-enrolled — matching the
 * 40-student-seat shape from Annexure-I so tools/sim (Phase 1) can drive
 * a realistic load test without further fixture work.
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
  const teacher = await prisma.user.upsert({
    where: { serviceNumber: 'TCH-001' },
    update: {},
    create: {
      serviceNumber: 'TCH-001',
      fullName: 'R.S. Shekhawat',
      rank: 'Lt Col',
      role: 'TEACHER',
      passwordHash: teacherPasswordHash,
    },
  });

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

  // eslint-disable-next-line no-console
  console.log(`Seeded: admin=${admin.serviceNumber} teacher=${teacher.serviceNumber} batch=${batch.name} + 40 students`);
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
