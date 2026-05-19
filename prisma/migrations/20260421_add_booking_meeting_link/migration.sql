-- Add optional meetingLink to BookingRequest
-- Idempotent: safe to re-run
ALTER TABLE "BookingRequest" ADD COLUMN IF NOT EXISTS "meetingLink" TEXT;
