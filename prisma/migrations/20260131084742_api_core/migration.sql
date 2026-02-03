-- CreateTable
CREATE TABLE "BoardStatsCache" (
    "boardId" TEXT NOT NULL,
    "windowHours" INTEGER NOT NULL,
    "avgUp" DOUBLE PRECISION NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "thresholdUp" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- Add generated search vector for FTS
ALTER TABLE "Post"
ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
  to_tsvector('simple', coalesce("title",'') || ' ' || coalesce("body",''))
) STORED;

-- CreateIndex
CREATE INDEX "Post_searchVector_idx" ON "Post" USING GIN ("searchVector");

-- CreateTable
CREATE TABLE "PostViewEvent" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "viewerKeyHash" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostViewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BoardStatsCache_boardId_key" ON "BoardStatsCache"("boardId");

-- CreateIndex
CREATE INDEX "PostViewEvent_postId_windowStart_idx" ON "PostViewEvent"("postId", "windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "PostViewEvent_postId_viewerKeyHash_windowStart_key" ON "PostViewEvent"("postId", "viewerKeyHash", "windowStart");

-- AddForeignKey
ALTER TABLE "BoardStatsCache" ADD CONSTRAINT "BoardStatsCache_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostViewEvent" ADD CONSTRAINT "PostViewEvent_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
