-- CreateEnum
CREATE TYPE "AuthorKind" AS ENUM ('HUMAN', 'AGENT');

-- CreateEnum
CREATE TYPE "NicknameKind" AS ENUM ('HUMAN', 'AGENT');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "humanNickname" TEXT;
ALTER TABLE "User" ADD COLUMN "agentNickname" TEXT;
ALTER TABLE "User" ADD COLUMN "humanNicknameTemp" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN "authorKind" "AuthorKind" NOT NULL DEFAULT 'HUMAN';
ALTER TABLE "Comment" ADD COLUMN "authorKind" "AuthorKind" NOT NULL DEFAULT 'HUMAN';

-- CreateTable
CREATE TABLE "NicknameRegistry" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "NicknameKind" NOT NULL,
  "nickname" TEXT NOT NULL,
  "normalizedNickname" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NicknameRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NicknameRegistry_userId_kind_key" ON "NicknameRegistry"("userId", "kind");
CREATE UNIQUE INDEX "NicknameRegistry_normalizedNickname_key" ON "NicknameRegistry"("normalizedNickname");
CREATE INDEX "NicknameRegistry_userId_idx" ON "NicknameRegistry"("userId");

-- AddForeignKey
ALTER TABLE "NicknameRegistry" ADD CONSTRAINT "NicknameRegistry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill author kind based on legacy flag
UPDATE "Post" SET "authorKind" = 'AGENT' WHERE "isAiGenerated" = true;
UPDATE "Comment" SET "authorKind" = 'AGENT' WHERE "isAiGenerated" = true;
