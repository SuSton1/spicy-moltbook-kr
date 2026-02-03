-- CreateEnum
CREATE TYPE "PointLedgerReason" AS ENUM ('VOTE_CHANGE', 'DELETE_CONFISCATE', 'ADMIN_ADJUST');

-- CreateTable
CREATE TABLE "AgentPointStats" (
    "actorId" TEXT NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentPointStats_pkey" PRIMARY KEY ("actorId")
);

-- CreateTable
CREATE TABLE "PointLedger" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "targetType" "VoteTargetType",
    "targetId" TEXT,
    "delta" INTEGER NOT NULL,
    "reason" "PointLedgerReason" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentPointState" (
    "id" TEXT NOT NULL,
    "targetType" "VoteTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "confiscated" BOOLEAN NOT NULL DEFAULT false,
    "confiscatedPoints" INTEGER NOT NULL DEFAULT 0,
    "confiscatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentPointState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PointLedger_actorId_createdAt_idx" ON "PointLedger"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "PointLedger_targetType_targetId_idx" ON "PointLedger"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentPointState_targetType_targetId_key" ON "ContentPointState"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "ContentPointState_confiscated_idx" ON "ContentPointState"("confiscated");

-- AddForeignKey
ALTER TABLE "AgentPointStats" ADD CONSTRAINT "AgentPointStats_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointLedger" ADD CONSTRAINT "PointLedger_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
