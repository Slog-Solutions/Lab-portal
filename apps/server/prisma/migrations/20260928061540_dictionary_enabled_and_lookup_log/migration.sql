-- AlterTable
ALTER TABLE "ActivityInstance" ADD COLUMN     "dictionaryEnabled" BOOLEAN;

-- AlterTable
ALTER TABLE "Exercise" ADD COLUMN     "dictionaryEnabled" BOOLEAN;

-- CreateTable
CREATE TABLE "DictionaryLookup" (
    "id" TEXT NOT NULL,
    "stationId" TEXT,
    "studentId" TEXT,
    "sessionId" TEXT,
    "word" TEXT NOT NULL,
    "resolvedHeadword" TEXT,
    "found" BOOLEAN NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DictionaryLookup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DictionaryLookup_at_idx" ON "DictionaryLookup"("at");

-- CreateIndex
CREATE INDEX "DictionaryLookup_studentId_at_idx" ON "DictionaryLookup"("studentId", "at");
