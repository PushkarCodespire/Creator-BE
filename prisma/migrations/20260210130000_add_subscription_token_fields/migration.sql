-- Add token fields to Subscription for premium usage tracking
ALTER TABLE "Subscription"
  ADD COLUMN IF NOT EXISTS "tokenBalance" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tokenGrant" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "tokenGrantedAt" TIMESTAMP(3);
