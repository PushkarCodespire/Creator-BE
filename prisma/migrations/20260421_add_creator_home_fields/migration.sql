-- Add home-page placement fields to Creator (admin-managed)
-- Idempotent: safe to re-run
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "isFeatured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "featuredOrder" INTEGER;
ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "isMainHighlight" BOOLEAN NOT NULL DEFAULT false;
