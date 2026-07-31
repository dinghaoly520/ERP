-- CreateTable: A3 中标通知书送达签收
CREATE TABLE "AwardLetterDelivery" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "letterAssetId" TEXT,
    "content" JSONB,
    "deliveredAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "signedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AwardLetterDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AwardLetterDelivery_projectId_supplierId_key" ON "AwardLetterDelivery"("projectId", "supplierId");
CREATE INDEX "AwardLetterDelivery_projectId_idx" ON "AwardLetterDelivery"("projectId");
ALTER TABLE "AwardLetterDelivery" ADD CONSTRAINT "AwardLetterDelivery_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE;
