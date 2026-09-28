-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "sharedBatchIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
