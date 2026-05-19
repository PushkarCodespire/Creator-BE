-- Add missing User profile columns (were in schema but never migrated)
-- Idempotent: safe to re-run

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'dateOfBirth'
  ) THEN
    ALTER TABLE "User" ADD COLUMN "dateOfBirth" TIMESTAMP(3);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'location'
  ) THEN
    ALTER TABLE "User" ADD COLUMN "location" TEXT;
  END IF;
END $$;
