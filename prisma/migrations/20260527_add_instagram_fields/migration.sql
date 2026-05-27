-- Add Instagram OAuth fields to Creator
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "instagramUserId" TEXT;
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "instagramAccessToken" TEXT;
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "instagramTokenExpiresAt" TIMESTAMP(3);
