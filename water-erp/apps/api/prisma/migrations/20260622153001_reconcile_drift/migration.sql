-- DropForeignKey
ALTER TABLE "BidScoreRecord" DROP CONSTRAINT "BidScoreRecord_supplierId_fkey";

-- AlterTable
ALTER TABLE "BidExpert" ALTER COLUMN "totalScore" SET DATA TYPE DECIMAL(8,1);

-- AlterTable
ALTER TABLE "FileAsset" ADD COLUMN     "sealedPath" TEXT;

-- AlterTable
ALTER TABLE "SupplierBidSubmission" ADD COLUMN     "fileHash" TEXT,
ADD COLUMN     "signature" TEXT,
ADD COLUMN     "signedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BidSupervisionAnnotation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'flagged',
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BidSupervisionAnnotation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BidSupervisionAnnotation_supplierId_key" ON "BidSupervisionAnnotation"("supplierId");

-- CreateIndex
CREATE INDEX "BidSupervisionAnnotation_projectId_idx" ON "BidSupervisionAnnotation"("projectId");

-- CreateIndex
CREATE INDEX "BidArchiveItem_projectId_idx" ON "BidArchiveItem"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "BidArchiveItem_projectId_name_key" ON "BidArchiveItem"("projectId", "name");

-- CreateIndex
CREATE INDEX "BidClarification_projectId_idx" ON "BidClarification"("projectId");

-- CreateIndex
CREATE INDEX "BidOpeningRecord_projectId_idx" ON "BidOpeningRecord"("projectId");

-- CreateIndex
CREATE INDEX "BidScoreItem_projectId_idx" ON "BidScoreItem"("projectId");

-- CreateIndex
CREATE INDEX "BidScoreRecord_scoreItemId_supplierId_idx" ON "BidScoreRecord"("scoreItemId", "supplierId");

-- CreateIndex
CREATE INDEX "BidSupervisionLog_projectId_idx" ON "BidSupervisionLog"("projectId");

-- AddForeignKey
ALTER TABLE "BidScoreRecord" ADD CONSTRAINT "BidScoreRecord_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "BidSupplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidSupervisionAnnotation" ADD CONSTRAINT "BidSupervisionAnnotation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidSupervisionAnnotation" ADD CONSTRAINT "BidSupervisionAnnotation_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "BidSupplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

