-- AlterTable
ALTER TABLE "ContentPackage" ADD COLUMN     "builtinKey" TEXT,
ADD COLUMN     "cefrLevel" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "gradeLevel" TEXT,
ADD COLUMN     "publisher" TEXT,
ALTER COLUMN "ownerId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "ContentPackage_builtinKey_key" ON "ContentPackage"("builtinKey");

