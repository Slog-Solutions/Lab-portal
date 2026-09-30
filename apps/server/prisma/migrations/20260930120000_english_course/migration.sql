-- AlterEnum
ALTER TYPE "ActivityType" ADD VALUE 'ENGLISH_COURSE';

-- AlterTable
ALTER TABLE "Exercise" ADD COLUMN     "catalogKey" TEXT,
ALTER COLUMN "teacherId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Exercise_catalogKey_key" ON "Exercise"("catalogKey");

