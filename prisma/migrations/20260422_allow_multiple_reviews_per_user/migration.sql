-- Allow a user to leave multiple reviews for the same creator.
-- Drop the existing unique constraint and replace it with a plain composite index.

ALTER TABLE "CreatorReview" DROP CONSTRAINT IF EXISTS "CreatorReview_creatorId_userId_key";
DROP INDEX IF EXISTS "CreatorReview_creatorId_userId_key";

CREATE INDEX IF NOT EXISTS "CreatorReview_creatorId_userId_idx" ON "CreatorReview"("creatorId", "userId");
