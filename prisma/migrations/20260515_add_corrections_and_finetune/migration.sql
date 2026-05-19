-- Add AI training fields to Creator
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "fineTunedModelId" TEXT;
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "fineTuneStatus"   TEXT DEFAULT 'none';
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "fineTuneJobId"    TEXT;
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "lastFineTunedAt"  TIMESTAMP(3);

-- Corrections table
CREATE TABLE IF NOT EXISTS "MessageCorrection" (
  "id"               TEXT NOT NULL,
  "creatorId"        TEXT NOT NULL,
  "userMessage"      TEXT NOT NULL,
  "rejectedResponse" TEXT NOT NULL,
  "chosenResponse"   TEXT NOT NULL,
  "isActive"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageCorrection_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "MessageCorrection"
  ADD CONSTRAINT "MessageCorrection_creatorId_fkey"
  FOREIGN KEY ("creatorId") REFERENCES "Creator"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "MessageCorrection_creatorId_isActive_idx"  ON "MessageCorrection"("creatorId", "isActive");
CREATE INDEX IF NOT EXISTS "MessageCorrection_creatorId_createdAt_idx" ON "MessageCorrection"("creatorId", "createdAt");
