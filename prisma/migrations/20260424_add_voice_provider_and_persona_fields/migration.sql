-- Add voice provider fields and AI persona config to Creator.
-- Idempotent: safe to re-run.
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "voiceProvider"     TEXT NOT NULL DEFAULT 'chatterbox';
-- Backfill existing rows that got the old 'inworld' default so voice clone works without Inworld API key
UPDATE "Creator" SET "voiceProvider" = 'chatterbox' WHERE "voiceProvider" = 'inworld';
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "voiceIdChatterbox" TEXT;
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "voiceIdElevenlabs" TEXT;
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "voiceIdInworld"    TEXT;
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "personaConfig"     JSONB;
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "fewShotQA"         JSONB;
