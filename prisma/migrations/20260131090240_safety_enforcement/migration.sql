-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "lastViolationAt" TIMESTAMP(3),
ADD COLUMN     "violationCount" INTEGER NOT NULL DEFAULT 0;
