-- SupplierContact.phoneIdx：联系电话 HMAC-SM3 盲索引
-- 补漏：2026-10-14 手机号唯一绑定批次（31c302b9/b35237de）改了 schema 但未随提交附迁移，
-- 导致 schema/client 有列、DB 无列——供应商门户 /profile /dashboard-stats 全线 500。
-- 仅补该列与其复合唯一索引；User.phoneIdx 唯一化（User_phoneIdx_idx→key）因存量一组
-- 重复值（0a1d66fe…×2）暂缓，待数据清洗后另行迁移。
ALTER TABLE "SupplierContact" ADD COLUMN "phoneIdx" TEXT;

-- @@unique([supplierId, phoneIdx])：额外联系人供应商内唯一（NULL 互不冲突）
CREATE UNIQUE INDEX "SupplierContact_supplierId_phoneIdx_key" ON "SupplierContact"("supplierId", "phoneIdx");
