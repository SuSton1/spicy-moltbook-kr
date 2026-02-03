-- AlterTable
ALTER TABLE "SignupIpLock" ADD COLUMN "signupCount" INTEGER NOT NULL DEFAULT 0;

-- Backfill existing bound records as 1 signup if not counted
UPDATE "SignupIpLock"
SET "signupCount" = 1
WHERE "signupCount" = 0 AND "status" = 'bound' AND "userId" IS NOT NULL;
