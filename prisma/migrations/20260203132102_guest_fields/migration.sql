-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "authorType" TEXT,
ADD COLUMN     "authorUserId" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "guestPwHash" TEXT;

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "authorType" TEXT,
ADD COLUMN     "authorUserId" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "guestPwHash" TEXT;

