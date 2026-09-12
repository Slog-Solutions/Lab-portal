-- LMS admin core: batch code/joinKey/joinOpen, BatchTeacher assignment,
-- Enrollment provenance. Hand-edited (not a raw `prisma migrate dev` diff)
-- to add nullable-first + backfill steps for the two NOT NULL columns
-- being added to a populated Batch table, and to backfill BatchTeacher so
-- enforcing teacher->batch assignment doesn't strand the seeded teachers.

-- ============================================================ Batch ===

-- AlterTable (nullable first — table is populated)
ALTER TABLE "Batch" ADD COLUMN     "code" TEXT,
ADD COLUMN     "joinKey" TEXT,
ADD COLUMN     "joinOpen" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill: the known seed batch gets its real display code/key; any
-- other pre-existing batch (none expected outside seed.ts, but be safe)
-- gets a generated fallback so the NOT NULL constraint below can land.
UPDATE "Batch" SET "code" = 'ACTC-B01', "joinKey" = 'ACTC-KEY-01' WHERE id = 'seedbatchactc01';
UPDATE "Batch" SET "code" = 'BATCH-' || upper(left(id, 8)) WHERE "code" IS NULL;
UPDATE "Batch" SET "joinKey" = upper(left(md5(random()::text), 10)) WHERE "joinKey" IS NULL;

-- AlterTable (now safe to constrain)
ALTER TABLE "Batch" ALTER COLUMN "code" SET NOT NULL;
ALTER TABLE "Batch" ALTER COLUMN "joinKey" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Batch_code_key" ON "Batch"("code");

-- ======================================================= Enrollment ===

-- AlterTable — both new columns have real defaults, no backfill needed.
ALTER TABLE "Enrollment" ADD COLUMN     "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'ADMIN';

-- ===================================================== BatchTeacher ===

-- CreateTable
CREATE TABLE "BatchTeacher" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchTeacher_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BatchTeacher_teacherId_idx" ON "BatchTeacher"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "BatchTeacher_batchId_teacherId_key" ON "BatchTeacher"("batchId", "teacherId");

-- AddForeignKey
ALTER TABLE "BatchTeacher" ADD CONSTRAINT "BatchTeacher_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchTeacher" ADD CONSTRAINT "BatchTeacher_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing teacher gets every existing batch, so
-- enforcing assignment doesn't strand seed.ts's TCH-001/002/003 out of
-- "ACTC Batch 01" — this preserves today's de-facto "any teacher can use
-- any batch" behaviour for pre-existing data; new batches/teachers going
-- forward require an explicit admin assignment.
INSERT INTO "BatchTeacher" ("id", "batchId", "teacherId", "assignedAt")
SELECT gen_random_uuid()::text, b.id, u.id, CURRENT_TIMESTAMP
FROM "Batch" b CROSS JOIN "User" u
WHERE u.role = 'TEACHER'
ON CONFLICT ("batchId", "teacherId") DO NOTHING;
