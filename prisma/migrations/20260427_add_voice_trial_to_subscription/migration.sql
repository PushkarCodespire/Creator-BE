-- Add voice trial counter for free users.
-- Idempotent: safe to re-run.
ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "voiceTrialUsed" INTEGER NOT NULL DEFAULT 0;
