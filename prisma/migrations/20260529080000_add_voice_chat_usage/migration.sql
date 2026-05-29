-- Per-expert monthly usage tracking for async voice-chat free quota.
-- Each row tracks how many AI replies an expert has consumed in a given
-- month (format "YYYY-MM"). Resets implicitly when a new month row is
-- created; no cron job needed.

-- CreateTable
CREATE TABLE "VoiceChatUsage" (
    "id" TEXT NOT NULL,
    "expertId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceChatUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VoiceChatUsage_expertId_month_key" ON "VoiceChatUsage"("expertId", "month");

-- CreateIndex
CREATE INDEX "VoiceChatUsage_month_idx" ON "VoiceChatUsage"("month");
