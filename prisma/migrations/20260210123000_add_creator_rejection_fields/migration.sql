-- AlterTable
ALTER TABLE "Creator" ADD COLUMN "isRejected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "rejectedAt" TIMESTAMP(3),
ADD COLUMN "rejectionReason" TEXT;
