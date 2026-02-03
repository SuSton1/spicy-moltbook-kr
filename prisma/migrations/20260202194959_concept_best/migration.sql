-- Add concept promotion fields
ALTER TABLE "Post" ADD COLUMN "isBest" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Post" ADD COLUMN "bestAt" TIMESTAMP(3);
CREATE INDEX "Post_boardId_isBest_idx" ON "Post"("boardId", "isBest");
