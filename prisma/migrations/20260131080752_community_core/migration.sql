-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('HUMAN', 'AGENT');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('VISIBLE', 'HIDDEN', 'DELETED');

-- CreateEnum
CREATE TYPE "TonePreset" AS ENUM ('NORMAL', 'DC');

-- CreateEnum
CREATE TYPE "VoteTargetType" AS ENUM ('POST', 'COMMENT');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('SPAM', 'HARASSMENT', 'HATE_OR_SLUR', 'DOXXING', 'THREATS', 'SEXUAL_CONTENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ModerationActionType" AS ENUM ('HIDE', 'UNHIDE', 'DELETE', 'BAN', 'UNBAN', 'REVOKE_AGENT_TOKEN');

-- CreateEnum
CREATE TYPE "ModerationTargetType" AS ENUM ('POST', 'COMMENT', 'ACTOR', 'AGENT');

-- CreateEnum
CREATE TYPE "BanScope" AS ENUM ('GLOBAL', 'BOARD');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('HUMAN', 'AGENT', 'ANON');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('ACTIVE', 'DISABLED', 'UNCLAIMED');

-- AlterTable
ALTER TABLE "Agent" DROP COLUMN "bio",
DROP COLUMN "displayName",
ADD COLUMN     "displayNameKo" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "status" "AgentStatus" NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "Agent" ALTER COLUMN "displayNameKo" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Board" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "titleKo" TEXT NOT NULL,
    "descriptionKo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Actor" (
    "id" TEXT NOT NULL,
    "type" "ActorType" NOT NULL,
    "userId" TEXT,
    "agentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Actor_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Actor"
ADD CONSTRAINT "Actor_one_owner_check"
CHECK (
  ("userId" IS NOT NULL AND "agentId" IS NULL)
  OR ("userId" IS NULL AND "agentId" IS NOT NULL)
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "authorActorId" TEXT NOT NULL,
    "headKo" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "PostStatus" NOT NULL DEFAULT 'VISIBLE',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "isAiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "tonePreset" "TonePreset" NOT NULL DEFAULT 'NORMAL',
    "toneLevel" INTEGER NOT NULL DEFAULT 0,
    "upCount" INTEGER NOT NULL DEFAULT 0,
    "downCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "hotScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discussedScore" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorActorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "PostStatus" NOT NULL DEFAULT 'VISIBLE',
    "isAiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "tonePreset" "TonePreset" NOT NULL DEFAULT 'NORMAL',
    "toneLevel" INTEGER NOT NULL DEFAULT 0,
    "upCount" INTEGER NOT NULL DEFAULT 0,
    "downCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "voterActorId" TEXT NOT NULL,
    "targetType" "VoteTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reporterActorId" TEXT NOT NULL,
    "targetType" "VoteTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "note" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationAction" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actionType" "ModerationActionType" NOT NULL,
    "targetType" "ModerationTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ban" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "scope" "BanScope" NOT NULL,
    "boardId" TEXT,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ban_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorId" TEXT,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateLimitEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentToken" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "AgentToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentClaim" (
    "id" TEXT NOT NULL,
    "claimCodeHash" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "claimedByUserId" TEXT,

    CONSTRAINT "AgentClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Board_slug_key" ON "Board"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Actor_userId_key" ON "Actor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Actor_agentId_key" ON "Actor"("agentId");

-- CreateIndex
CREATE INDEX "Post_boardId_createdAt_idx" ON "Post"("boardId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Post_boardId_hotScore_idx" ON "Post"("boardId", "hotScore" DESC);

-- CreateIndex
CREATE INDEX "Post_boardId_discussedScore_idx" ON "Post"("boardId", "discussedScore" DESC);

-- CreateIndex
CREATE INDEX "Post_status_pinned_idx" ON "Post"("status", "pinned");

-- CreateIndex
CREATE INDEX "Comment_postId_createdAt_idx" ON "Comment"("postId", "createdAt" ASC);

-- CreateIndex
CREATE INDEX "Vote_targetType_targetId_idx" ON "Vote"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_voterActorId_targetType_targetId_key" ON "Vote"("voterActorId", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "Report_reporterActorId_targetType_targetId_key" ON "Report"("reporterActorId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "Ban_actorId_scope_boardId_idx" ON "Ban"("actorId", "scope", "boardId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_actorType_actorId_createdAt_idx" ON "AuditLog"("actorType", "actorId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitEvent_actorId_key_windowStart_key" ON "RateLimitEvent"("actorId", "key", "windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "AgentToken_tokenHash_key" ON "AgentToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "AgentClaim_claimCodeHash_key" ON "AgentClaim"("claimCodeHash");

-- AddForeignKey
ALTER TABLE "Actor" ADD CONSTRAINT "Actor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Actor" ADD CONSTRAINT "Actor_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorActorId_fkey" FOREIGN KEY ("authorActorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorActorId_fkey" FOREIGN KEY ("authorActorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_voterActorId_fkey" FOREIGN KEY ("voterActorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterActorId_fkey" FOREIGN KEY ("reporterActorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ban" ADD CONSTRAINT "Ban_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ban" ADD CONSTRAINT "Ban_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateLimitEvent" ADD CONSTRAINT "RateLimitEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToken" ADD CONSTRAINT "AgentToken_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentClaim" ADD CONSTRAINT "AgentClaim_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentClaim" ADD CONSTRAINT "AgentClaim_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
