-- AlterEnum
ALTER TYPE "RecordingKind" ADD VALUE 'CLASS_BROADCAST';

-- AlterTable
ALTER TABLE "Recording" ADD COLUMN     "chunkCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "liveClassId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "withAudio" BOOLEAN;

-- CreateIndex
CREATE INDEX "Recording_liveClassId_idx" ON "Recording"("liveClassId");

-- CreateIndex
CREATE INDEX "Recording_createdById_idx" ON "Recording"("createdById");

-- AddForeignKey
ALTER TABLE "Recording" ADD CONSTRAINT "Recording_liveClassId_fkey" FOREIGN KEY ("liveClassId") REFERENCES "LiveClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recording" ADD CONSTRAINT "Recording_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

