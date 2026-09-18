-- CreateEnum
CREATE TYPE "LiveClassState" AS ENUM ('ACTIVE', 'ENDED');

-- AlterTable
ALTER TABLE "Batch" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Station" ADD COLUMN     "liveClassId" TEXT;

-- CreateTable
CREATE TABLE "LiveClass" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "state" "LiveClassState" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "LiveClass_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LiveClass_code_key" ON "LiveClass"("code");

-- CreateIndex
CREATE INDEX "LiveClass_teacherId_state_idx" ON "LiveClass"("teacherId", "state");

-- CreateIndex
CREATE INDEX "Station_liveClassId_idx" ON "Station"("liveClassId");

-- AddForeignKey
ALTER TABLE "Station" ADD CONSTRAINT "Station_liveClassId_fkey" FOREIGN KEY ("liveClassId") REFERENCES "LiveClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveClass" ADD CONSTRAINT "LiveClass_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
