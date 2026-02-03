-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "lastHeartbeatAt" TIMESTAMP(3),
ADD COLUMN     "lastHeartbeatSummary" JSONB,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ALTER COLUMN "ownerUserId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "IpRateLimitEvent" (
    "id" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IpRateLimitEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IpRateLimitEvent_ipHash_key_windowStart_idx" ON "IpRateLimitEvent"("ipHash", "key", "windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "IpRateLimitEvent_ipHash_key_windowStart_key" ON "IpRateLimitEvent"("ipHash", "key", "windowStart");
