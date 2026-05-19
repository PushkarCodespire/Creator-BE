-- DropForeignKey
ALTER TABLE "ModerationLog" DROP CONSTRAINT "ModerationLog_moderatorId_fkey";

-- AlterTable
ALTER TABLE "ModerationLog" ADD COLUMN     "notes" TEXT,
ALTER COLUMN "moderatorId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "hiddenReason" TEXT,
ADD COLUMN     "isHidden" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "ModerationLog" ADD CONSTRAINT "ModerationLog_moderatorId_fkey" FOREIGN KEY ("moderatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
