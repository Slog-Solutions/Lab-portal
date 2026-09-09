/*
  Warnings:

  - Added the required column `ownerId` to the `ContentPackage` table without a default value. This is not possible if the table is not empty.
  - Added the required column `teacherId` to the `Exercise` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "RecordingKind" ADD VALUE 'PRONUNCIATION';

-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN     "assignmentId" TEXT,
ADD COLUMN     "itemOrder" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "maxScore" DOUBLE PRECISION,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS';

-- AlterTable
ALTER TABLE "ContentPackage" ADD COLUMN     "ownerId" TEXT NOT NULL,
ADD COLUMN     "scope" "MediaAssetScope" NOT NULL DEFAULT 'INSTITUTION',
ADD COLUMN     "sizeBytes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Exercise" ADD COLUMN     "teacherId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "mediaAssetId" TEXT,
ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'SHORT_ANSWER';

-- AlterTable
ALTER TABLE "ItemResponse" ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "score" DOUBLE PRECISION,
ADD COLUMN     "timeSpentMs" INTEGER;

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "title" TEXT;

-- CreateIndex
CREATE INDEX "Assignment_teacherId_idx" ON "Assignment"("teacherId");

-- CreateIndex
CREATE INDEX "Attempt_assignmentId_idx" ON "Attempt"("assignmentId");

-- CreateIndex
CREATE INDEX "Exercise_teacherId_idx" ON "Exercise"("teacherId");

-- CreateIndex
CREATE INDEX "Exercise_type_idx" ON "Exercise"("type");

-- CreateIndex
CREATE INDEX "Item_itemBankId_idx" ON "Item"("itemBankId");

-- AddForeignKey
ALTER TABLE "ContentPackage" ADD CONSTRAINT "ContentPackage_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
