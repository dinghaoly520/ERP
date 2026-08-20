-- 公告操作历史表（append-only，不可删改）
CREATE TABLE "announcement_histories" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT,
    "status" TEXT,
    "contentHash" TEXT,
    "contentLength" INTEGER,
    "changedFields" TEXT[],
    "operatorId" TEXT,
    "operatorName" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_histories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "announcement_histories_announcementId_createdAt_idx" ON "announcement_histories"("announcementId", "createdAt");
CREATE INDEX "announcement_histories_action_createdAt_idx" ON "announcement_histories"("action", "createdAt");
