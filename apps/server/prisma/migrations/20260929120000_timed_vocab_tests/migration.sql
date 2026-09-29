-- AlterTable
ALTER TABLE "ActivityInstance" ADD COLUMN     "closeKind" TEXT,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closesAt" TIMESTAMP(3),
ADD COLUMN     "exerciseId" TEXT,
ADD COLUMN     "finalizedAt" TIMESTAMP(3),
ADD COLUMN     "revealedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN     "answers" JSONB,
ADD COLUMN     "closesAt" TIMESTAMP(3),
ADD COLUMN     "revealAt" TIMESTAMP(3),
ADD COLUMN     "served" JSONB;

-- AlterTable
ALTER TABLE "Exercise" ADD COLUMN     "isAssessment" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "explanation" TEXT;

-- CreateIndex
CREATE INDEX "ActivityInstance_finalizedAt_closesAt_idx" ON "ActivityInstance"("finalizedAt", "closesAt");

-- CreateIndex
CREATE INDEX "Attempt_activityInstanceId_idx" ON "Attempt"("activityInstanceId");

-- CreateIndex
CREATE INDEX "Attempt_status_closesAt_idx" ON "Attempt"("status", "closesAt");

-- AddForeignKey
ALTER TABLE "ActivityInstance" ADD CONSTRAINT "ActivityInstance_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill (SPEC-mcq-test-timed-reveal.md): existing SUBMITTED/SCORED
-- attempts predate the reveal concept entirely, so treat them as already
-- revealed at the moment they finished — VocabularyTestPlayer has always
-- shown the score the instant a student submitted, and this keeps every
-- masking check (Attempt.revealAt <= now) consistent with that for rows
-- that already exist.
UPDATE "Attempt" SET "revealAt" = COALESCE("submittedAt", "startedAt") WHERE "status" IN ('SUBMITTED', 'SCORED');

-- Backfill: an already-assigned exercise should keep appearing in the
-- assessments list the same way it always has, independent of the new
-- isAssessment flag (which only matters for a test saved but not yet
-- assigned to anyone).
UPDATE "Exercise" SET "isAssessment" = true WHERE EXISTS (
  SELECT 1 FROM "Assignment" WHERE "Assignment"."exerciseId" = "Exercise"."id"
);
