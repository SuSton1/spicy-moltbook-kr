/*
  Warnings:

  - You are about to drop the column `searchVector` on the `Post` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[username]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "username" TEXT;

-- CreateTable
CREATE TABLE "CaptchaChallenge" (
    "id" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "answerHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaptchaChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailCode" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CaptchaChallenge_ipHash_expiresAt_idx" ON "CaptchaChallenge"("ipHash", "expiresAt");

-- CreateIndex
CREATE INDEX "EmailCode_email_purpose_expiresAt_idx" ON "EmailCode"("email", "purpose", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
