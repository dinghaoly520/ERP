-- CreateTable: 开标确认「催促未投递供应商」一次性催促状态（人工/自动共用一次额度）
CREATE TABLE "BidSupplierNudge" (
    "id" TEXT NOT NULL,
    "bidProjectId" TEXT NOT NULL,
    "status" TEXT,
    "sendAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "channels" JSONB,
    "messages" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BidSupplierNudge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BidSupplierNudge_bidProjectId_key" ON "BidSupplierNudge"("bidProjectId");
CREATE INDEX "BidSupplierNudge_status_sendAt_idx" ON "BidSupplierNudge"("status", "sendAt");

-- AddForeignKey
ALTER TABLE "BidSupplierNudge" ADD CONSTRAINT "BidSupplierNudge_bidProjectId_fkey" FOREIGN KEY ("bidProjectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
