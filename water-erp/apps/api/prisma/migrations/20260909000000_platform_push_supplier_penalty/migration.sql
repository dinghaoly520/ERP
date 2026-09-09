-- 对接专项 Phase 1：两新表（从全量 diff 摘取——库内另有已知刻意偏离，勿整段重放）
-- CreateTable
CREATE TABLE "SupplierPenalty" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "penaltyDocNo" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "decisionDate" TIMESTAMP(3) NOT NULL,
    "penaltyContent" TEXT NOT NULL,
    "publicUntil" TIMESTAMP(3),
    "attachmentAssetId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierPenalty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformPushLog" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "projectId" TEXT,
    "projectCode" TEXT,
    "status" TEXT NOT NULL,
    "payloadSha256" TEXT NOT NULL,
    "endpoint" TEXT,
    "packetAssetId" TEXT,
    "responseSnippet" TEXT,
    "errorMessage" TEXT,
    "attemptNo" INTEGER NOT NULL DEFAULT 1,
    "masked" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformPushLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPenalty_penaltyDocNo_key" ON "SupplierPenalty"("penaltyDocNo");

-- CreateIndex
CREATE INDEX "SupplierPenalty_supplierId_idx" ON "SupplierPenalty"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierPenalty_decisionDate_idx" ON "SupplierPenalty"("decisionDate");

-- CreateIndex
CREATE INDEX "PlatformPushLog_projectId_idx" ON "PlatformPushLog"("projectId");

-- CreateIndex
CREATE INDEX "PlatformPushLog_itemType_idx" ON "PlatformPushLog"("itemType");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPushLog_channel_itemId_payloadSha256_key" ON "PlatformPushLog"("channel", "itemId", "payloadSha256");
