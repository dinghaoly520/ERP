-- 个人中心部门公司隔离（2026-11-02）：Department 加归属公司；存量保持 null
-- （专家域遗留，不进 :3005 下拉）；内部员工部门由手输按本公司创建

-- AlterTable
ALTER TABLE "Department" ADD COLUMN "companyId" TEXT;

-- CreateIndex
CREATE INDEX "Department_companyId_idx" ON "Department"("companyId");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2026-11-02 追加：name 全局唯一改公司内唯一（跨公司同名部门合法；存量零重名，安全）
-- DropIndex
DROP INDEX "Department_name_key";
-- CreateIndex（复合：null companyId 的专家遗留不受约束）
CREATE UNIQUE INDEX "Department_companyId_name_key" ON "Department"("companyId", "name");
