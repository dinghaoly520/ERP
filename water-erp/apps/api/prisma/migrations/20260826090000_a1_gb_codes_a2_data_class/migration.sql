-- A1（GB/T 43711 B.4）：国标交易编码 + A2（表 B.1/B.3）：交易数据集分级
-- AlterTable（A1）
ALTER TABLE "BidProject" ADD COLUMN "gbProcureCode" TEXT;
ALTER TABLE "BidProject" ADD COLUMN "gbSectionCode" TEXT;
ALTER TABLE "ProjectManagementItem" ADD COLUMN "gbProjectCode" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "subjectCode" TEXT;

-- AlterTable（A2）
ALTER TABLE "Announcement" ADD COLUMN "dataClass" TEXT;
ALTER TABLE "Announcement" ADD COLUMN "dataDomain" TEXT;
ALTER TABLE "FileAsset" ADD COLUMN "dataClass" TEXT;
ALTER TABLE "FileAsset" ADD COLUMN "dataDomain" TEXT;

-- CreateIndex
CREATE INDEX "BidProject_gbProcureCode_idx" ON "BidProject"("gbProcureCode");
CREATE INDEX "Supplier_subjectCode_idx" ON "Supplier"("subjectCode");

-- A2 存量回填（表 B.1 默认值）
UPDATE "Announcement" SET "dataClass" = 'public_mandatory', "dataDomain" = 'trade'
  WHERE "type" IN ('BID_NOTICE','ADDENDUM','PREQUAL_NOTICE','PRE_WIN_NOTICE','WIN_NOTICE','CONTRACT_NOTICE','PERFORMANCE_NOTICE');
UPDATE "Announcement" SET "dataClass" = 'public_voluntary', "dataDomain" = 'trade'
  WHERE "type" IN ('POLICY','PLATFORM');
UPDATE "FileAsset" SET "dataClass" = 'confidential', "dataDomain" = 'rights'
  WHERE "category" IN ('bid_document_encrypted','bid_inner_ciphertext','bid_decrypted');
UPDATE "FileAsset" SET "dataClass" = 'public_conditional', "dataDomain" = 'trade'
  WHERE "category" = 'bid_document';
UPDATE "FileAsset" SET "dataClass" = 'confidential', "dataDomain" = 'trade'
  WHERE "category" IN ('contract_document','prequal_document','framework_document','project_attachment','tender_document');
