-- AlterTable
ALTER TABLE "Assignment" ADD COLUMN     "batchId" TEXT;

-- AlterTable
ALTER TABLE "SessionMember" ADD COLUMN     "studentId" TEXT;

-- CreateIndex
CREATE INDEX "Assignment_batchId_idx" ON "Assignment"("batchId");

-- CreateIndex
CREATE INDEX "SessionMember_studentId_idx" ON "SessionMember"("studentId");

-- AddForeignKey
ALTER TABLE "SessionMember" ADD CONSTRAINT "SessionMember_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

