-- Backfill required user fields before NOT NULL
UPDATE "User"
SET "username" = 'user_' || "id"
WHERE "username" IS NULL;

UPDATE "User"
SET "email" = 'user_' || "id" || '@invalid.local'
WHERE "email" IS NULL;

UPDATE "User"
SET "passwordHash" = '$2b$12$zxXU.UjokfseHizQBoNGT.b.kYtlcbEOQYAESrkRn1xGhLb9XY2P2'
WHERE "passwordHash" IS NULL;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "email" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "passwordHash" SET NOT NULL;

-- CreateTable
CREATE TABLE "SignupIpLock" (
    "ip" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reservedUntil" TIMESTAMP(3) NOT NULL,
    "boundAt" TIMESTAMP(3),
    "userId" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignupIpLock_pkey" PRIMARY KEY ("ip")
);

-- CreateTable
CREATE TABLE "SignupDeviceLock" (
    "deviceIdHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reservedUntil" TIMESTAMP(3) NOT NULL,
    "boundAt" TIMESTAMP(3),
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignupDeviceLock_pkey" PRIMARY KEY ("deviceIdHash")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowSec" INTEGER NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "ip" TEXT,
    "userId" TEXT,
    "path" TEXT,
    "method" TEXT,
    "ua" TEXT,
    "metaJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthLock" (
    "key" TEXT NOT NULL,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "lockUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthLock_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AgentNonce" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentNonce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CooldownState" (
    "key" TEXT NOT NULL,
    "lastAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CooldownState_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "SignupIpLock_status_idx" ON "SignupIpLock"("status");

-- CreateIndex
CREATE INDEX "SignupIpLock_userId_idx" ON "SignupIpLock"("userId");

-- CreateIndex
CREATE INDEX "SignupDeviceLock_status_idx" ON "SignupDeviceLock"("status");

-- CreateIndex
CREATE INDEX "SignupDeviceLock_userId_idx" ON "SignupDeviceLock"("userId");

-- CreateIndex
CREATE INDEX "RateLimitBucket_resetAt_idx" ON "RateLimitBucket"("resetAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_type_createdAt_idx" ON "SecurityEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_ip_createdAt_idx" ON "SecurityEvent"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_userId_createdAt_idx" ON "SecurityEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RecoveryCode_usedAt_idx" ON "RecoveryCode"("usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentNonce_agentId_nonce_key" ON "AgentNonce"("agentId", "nonce");

-- CreateIndex
CREATE INDEX "AgentNonce_expiresAt_idx" ON "AgentNonce"("expiresAt");
