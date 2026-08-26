-- D2（GB/T 43711 4.1.5.2）：档案保存期 + 移交台账
-- AlterTable
ALTER TABLE "BidArchiveItem" ADD COLUMN "retentionUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ArchiveTransfer" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "transferredByName" TEXT NOT NULL,
    "receivedByName" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "itemCount" INT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchiveTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArchiveTransfer_projectId_idx" ON "ArchiveTransfer"("projectId");

-- 存量回填：已归档项保存期 = 归档日 + 15 年
UPDATE "BidArchiveItem"
SET "retentionUntil" = "archivedAt" + INTERVAL '15 years'
WHERE "status" = 'ARCHIVED' AND "archivedAt" IS NOT NULL AND "retentionUntil" IS NULL;
