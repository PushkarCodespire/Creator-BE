-- Comprehensive migration: add all missing tables and columns
-- All statements are idempotent (IF NOT EXISTS / DO $$ checks)

-- =============================================
-- MISSING TABLES
-- =============================================

-- Program
CREATE TABLE IF NOT EXISTS "Program" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "salesCount" INTEGER NOT NULL DEFAULT 0,
    "revenue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Program_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Program_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "Program_creatorId_idx" ON "Program"("creatorId");

-- BookingSlot
CREATE TABLE IF NOT EXISTS "BookingSlot" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "title" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL DEFAULT 'consultation',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BookingSlot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BookingSlot_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "BookingSlot_creatorId_startTime_idx" ON "BookingSlot"("creatorId", "startTime");

-- BookingRequest
CREATE TABLE IF NOT EXISTS "BookingRequest" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "type" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BookingRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BookingRequest_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "BookingSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BookingRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "BookingRequest_slotId_idx" ON "BookingRequest"("slotId");
CREATE INDEX IF NOT EXISTS "BookingRequest_userId_idx" ON "BookingRequest"("userId");

-- CreatorReview
CREATE TABLE IF NOT EXISTS "CreatorReview" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreatorReview_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CreatorReview_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CreatorReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "CreatorReview_creatorId_userId_key" ON "CreatorReview"("creatorId", "userId");
CREATE INDEX IF NOT EXISTS "CreatorReview_creatorId_idx" ON "CreatorReview"("creatorId");
CREATE INDEX IF NOT EXISTS "CreatorReview_userId_idx" ON "CreatorReview"("userId");

-- NewsletterSubscriber
CREATE TABLE IF NOT EXISTS "NewsletterSubscriber" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "subscribedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NewsletterSubscriber_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "NewsletterSubscriber_email_key" ON "NewsletterSubscriber"("email");

-- AiUsage (check — might exist as "AIUsage" from init)
CREATE TABLE IF NOT EXISTS "AiUsage" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "cost" DECIMAL(10,6) NOT NULL,
    "responseTime" INTEGER NOT NULL,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiUsage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "AiUsage_messageId_key" ON "AiUsage"("messageId");
CREATE INDEX IF NOT EXISTS "AiUsage_messageId_idx" ON "AiUsage"("messageId");
CREATE INDEX IF NOT EXISTS "AiUsage_createdAt_idx" ON "AiUsage"("createdAt");

-- =============================================
-- MISSING COLUMNS ON EXISTING TABLES
-- =============================================

DO $$
BEGIN
  -- User
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'User' AND column_name = 'dateOfBirth') THEN
    ALTER TABLE "User" ADD COLUMN "dateOfBirth" TIMESTAMP(3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'User' AND column_name = 'location') THEN
    ALTER TABLE "User" ADD COLUMN "location" TEXT;
  END IF;

  -- Creator
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Creator' AND column_name = 'aiSummary') THEN
    ALTER TABLE "Creator" ADD COLUMN "aiSummary" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Creator' AND column_name = 'aiSummaryHash') THEN
    ALTER TABLE "Creator" ADD COLUMN "aiSummaryHash" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Creator' AND column_name = 'voiceId') THEN
    ALTER TABLE "Creator" ADD COLUMN "voiceId" TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Creator' AND column_name = 'voiceStatus') THEN
    ALTER TABLE "Creator" ADD COLUMN "voiceStatus" TEXT;
  END IF;

  -- Conversation
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Conversation' AND column_name = 'takenOverAt') THEN
    ALTER TABLE "Conversation" ADD COLUMN "takenOverAt" TIMESTAMP(3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Conversation' AND column_name = 'releasedAt') THEN
    ALTER TABLE "Conversation" ADD COLUMN "releasedAt" TIMESTAMP(3);
  END IF;
END $$;
