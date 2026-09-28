-- AlterTable
ALTER TABLE "LiveClass" ADD COLUMN     "batchId" TEXT;

-- CreateIndex
CREATE INDEX "LiveClass_batchId_state_idx" ON "LiveClass"("batchId", "state");

-- AddForeignKey
ALTER TABLE "LiveClass" ADD CONSTRAINT "LiveClass_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
