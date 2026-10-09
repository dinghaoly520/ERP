-- 外部联系人公司隔离（2026-10-09）：编写采购文件/公告的联系人选择只显示本公司联系人，
-- Contact 表加 companyId/companyName（与既有隔离表同款写时快照模式）

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "companyName" TEXT;

-- 存量回填：平台上线以来的联系人均为采购中心（SWHI 主公司）所建，全部归属之
UPDATE "Contact" SET
  "companyId" = (SELECT "id" FROM "companies" WHERE "code" = 'SWHI'),
  "companyName" = (SELECT "name" FROM "companies" WHERE "code" = 'SWHI')
WHERE "companyId" IS NULL;

-- CreateIndex
CREATE INDEX "Contact_companyId_idx" ON "Contact"("companyId");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
