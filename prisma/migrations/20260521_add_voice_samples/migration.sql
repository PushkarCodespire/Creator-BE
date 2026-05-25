-- Add voiceSamples JSON field to Creator (stores per-clip metadata)
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "voiceSamples" JSONB;
