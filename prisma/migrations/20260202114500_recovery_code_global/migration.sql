-- AlterTable
ALTER TABLE "RecoveryCode" ADD COLUMN "codeHashGlobal" TEXT;

UPDATE "RecoveryCode"
SET "codeHashGlobal" = "codeHash"
WHERE "codeHashGlobal" IS NULL;

ALTER TABLE "RecoveryCode" ALTER COLUMN "codeHashGlobal" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryCode_codeHashGlobal_key" ON "RecoveryCode"("codeHashGlobal");
