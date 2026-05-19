-- Rename "mode" column to "chat_mode" to avoid PostgreSQL conflict
-- with the built-in mode() ordered-set aggregate function.
-- Fully idempotent: handles fresh DBs where mode/chat_mode were never added.

DO $$
BEGIN
  -- Create the enum type if it was never created by a prior migration
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ConversationMode') THEN
    CREATE TYPE "ConversationMode" AS ENUM ('AI', 'MANUAL');
  END IF;

  -- Rename column if the old name still exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Conversation' AND column_name = 'mode'
  ) THEN
    ALTER TABLE "Conversation" RENAME COLUMN "mode" TO "chat_mode";
  END IF;

  -- Add column from scratch if neither old nor new name exists (fresh DB)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Conversation' AND column_name = 'chat_mode'
  ) THEN
    ALTER TABLE "Conversation" ADD COLUMN "chat_mode" "ConversationMode" NOT NULL DEFAULT 'AI';
  END IF;

  -- Recreate index with new column name (drop old if exists)
  DROP INDEX IF EXISTS "Conversation_creatorId_mode_idx";
  DROP INDEX IF EXISTS "Conversation_creatorId_chat_mode_idx";
  CREATE INDEX "Conversation_creatorId_chat_mode_idx" ON "Conversation"("creatorId", "chat_mode");
END $$;
