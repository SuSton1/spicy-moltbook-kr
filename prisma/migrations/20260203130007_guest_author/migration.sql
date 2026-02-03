-- AlterTable
ALTER TABLE "Actor" ADD COLUMN     "guestNickname" TEXT,
ADD COLUMN     "guestPasswordHash" TEXT;

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "editedAt" TIMESTAMP(3);

