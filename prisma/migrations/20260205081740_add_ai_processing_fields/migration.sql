-- AlterTable
ALTER TABLE "Creator" ADD COLUMN     "allowNewConversations" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "bankDetails" JSONB,
ADD COLUMN     "discountFirstFive" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "firstMessageFree" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "maxMessagesPerDay" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "minimumPayout" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN     "paymentMethod" TEXT,
ADD COLUMN     "payoutSchedule" TEXT,
ADD COLUMN     "pricePerMessage" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "responseStyle" TEXT,
ADD COLUMN     "taxInfo" JSONB;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "aiModel" TEXT,
ADD COLUMN     "cacheHit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cached" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "errorType" TEXT,
ADD COLUMN     "processingStatus" TEXT,
ADD COLUMN     "processingTime" INTEGER,
ADD COLUMN     "retryCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Payout" ADD COLUMN     "notes" TEXT;

-- CreateTable
CREATE TABLE "PricingHistory" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "pricePerMessage" INTEGER NOT NULL,
    "firstMessageFree" BOOLEAN NOT NULL DEFAULT true,
    "discountFirstFive" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "changedBy" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIUsage" (
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

    CONSTRAINT "AIUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PricingHistory_creatorId_idx" ON "PricingHistory"("creatorId");

-- CreateIndex
CREATE INDEX "PricingHistory_createdAt_idx" ON "PricingHistory"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AIUsage_messageId_key" ON "AIUsage"("messageId");

-- CreateIndex
CREATE INDEX "AIUsage_createdAt_idx" ON "AIUsage"("createdAt");

-- CreateIndex
CREATE INDEX "AIUsage_messageId_idx" ON "AIUsage"("messageId");

-- AddForeignKey
ALTER TABLE "PricingHistory" ADD CONSTRAINT "PricingHistory_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIUsage" ADD CONSTRAINT "AIUsage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
