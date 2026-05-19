-- Add voice samples JSON field to Creator
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "voiceSamples" JSONB;
