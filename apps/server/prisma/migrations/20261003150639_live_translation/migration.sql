-- AlterTable
ALTER TABLE "LiveClass" ADD COLUMN     "spokenLanguage" TEXT NOT NULL DEFAULT 'eng',
ADD COLUMN     "translationEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "listenLanguage" TEXT;

-- CreateTable
CREATE TABLE "app_setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "app_setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "TranslationTestRun" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sourceLanguage" TEXT NOT NULL DEFAULT 'eng',
    "langs" TEXT[],
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "metrics" JSONB,
    "error" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TranslationTestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TranslationTestRun_teacherId_createdAt_idx" ON "TranslationTestRun"("teacherId", "createdAt");

-- AddForeignKey
ALTER TABLE "TranslationTestRun" ADD CONSTRAINT "TranslationTestRun_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

