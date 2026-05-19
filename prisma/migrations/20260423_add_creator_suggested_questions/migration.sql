-- Add suggestedQuestions to Creator (shown on public profile modal FAQ).
-- Idempotent: safe to re-run.
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "suggestedQuestions" TEXT[] DEFAULT ARRAY[]::TEXT[];
