-- A-143：BidClarification 供应商答复 5 列；A-153：监督推送适配层日志表
ALTER TABLE "BidClarification" ADD COLUMN "replyAttachmentIds" JSONB,
ADD COLUMN "replyByName" TEXT,
ADD COLUMN "replyChannel" TEXT,
ADD COLUMN "replyOfflineReason" TEXT,
ADD COLUMN "replySignature" JSONB;

-- CreateTable
CREATE TABLE "SupervisionPushLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "payloadType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "endpoint" TEXT,
    "requestSha256" TEXT,
    "packetAssetId" TEXT,
    "responseCode" INTEGER,
    "responseSnippet" TEXT,
    "errorMessage" TEXT,
    "attemptNo" INTEGER NOT NULL DEFAULT 1,
    "signedBy" TEXT,
    "voucherAssetId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupervisionPushLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupervisionPushLog_projectId_payloadType_idx" ON "SupervisionPushLog"("projectId", "payloadType");

-- AddForeignKey
ALTER TABLE "SupervisionPushLog" ADD CONSTRAINT "SupervisionPushLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
