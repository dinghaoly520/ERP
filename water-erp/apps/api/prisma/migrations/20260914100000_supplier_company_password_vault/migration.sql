-- 2026-09-14 admin 密码查看 + 供应商公司归属
-- User.passwordVault：AES-256-GCM 加密的密码查看副本（仅供应商账号）
ALTER TABLE "User" ADD COLUMN "passwordVault" TEXT;

-- Supplier 公司归属：账号管理按公司分组（注册选择 + admin 可改）
ALTER TABLE "Supplier" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "companyName" TEXT;

-- AddForeignKey（Company 主数据表实际为 companies，@@map）
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
