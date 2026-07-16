-- CreateTable
CREATE TABLE "ExpertMemo" (
    "id" TEXT NOT NULL,
    "expertId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "supplierId" TEXT,
    "scoreItemId" TEXT,
    "contentText" TEXT,
    "inkFileId" TEXT,
    "sourceDevice" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpertMemo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpertMemo_expertId_projectId_idx" ON "ExpertMemo"("expertId", "projectId");

-- CreateIndex
CREATE INDEX "ExpertMemo_projectId_supplierId_idx" ON "ExpertMemo"("projectId", "supplierId");

-- AddForeignKey
ALTER TABLE "ExpertMemo" ADD CONSTRAINT "ExpertMemo_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "BidExpert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpertMemo" ADD CONSTRAINT "ExpertMemo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpertMemo" ADD CONSTRAINT "ExpertMemo_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "BidSupplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpertMemo" ADD CONSTRAINT "ExpertMemo_scoreItemId_fkey" FOREIGN KEY ("scoreItemId") REFERENCES "BidScoreItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpertMemo" ADD CONSTRAINT "ExpertMemo_inkFileId_fkey" FOREIGN KEY ("inkFileId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
