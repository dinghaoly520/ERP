-- 供应商投标文件资产引用：指向 FileAsset.id，可验证、可授权下载
-- 仅追加可空列，不影响存量数据；旧字符串字段 (technicalFile/businessFile/coverLetter) 保留以兼容
ALTER TABLE "SupplierBidSubmission"
  ADD COLUMN "technicalFileAssetId" TEXT,
  ADD COLUMN "businessFileAssetId" TEXT,
  ADD COLUMN "coverLetterAssetId" TEXT;

CREATE INDEX "SupplierBidSubmission_technicalFileAssetId_idx" ON "SupplierBidSubmission"("technicalFileAssetId");
CREATE INDEX "SupplierBidSubmission_businessFileAssetId_idx" ON "SupplierBidSubmission"("businessFileAssetId");
CREATE INDEX "SupplierBidSubmission_coverLetterAssetId_idx" ON "SupplierBidSubmission"("coverLetterAssetId");
