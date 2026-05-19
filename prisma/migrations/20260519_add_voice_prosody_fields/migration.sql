-- Add voice prosody tuning fields to Creator
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "voiceSpeakingRate" DOUBLE PRECISION;
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "voicePitch"        DOUBLE PRECISION;
