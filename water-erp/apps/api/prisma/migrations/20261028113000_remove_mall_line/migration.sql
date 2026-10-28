-- 采购商城整线下线（spec 2026-10-28-remove-mall-portal-design）
-- 手写迁移：金仓影子库无法重放旧迁移链（gen_random_uuid 缺失），migrate dev 不可用，
-- 走 db execute + migrate resolve 轨道。drop 前已有双库备份（Task 1）。

-- 1) 商城模型家族 19 张表（CASCADE 清理相互外键）
DROP TABLE IF EXISTS "CatalogCategory" CASCADE;
DROP TABLE IF EXISTS "CategoryAttributeTemplate" CASCADE;
DROP TABLE IF EXISTS "CatalogItemAttribute" CASCADE;
DROP TABLE IF EXISTS "CatalogVersion" CASCADE;
DROP TABLE IF EXISTS "CatalogInquiry" CASCADE;
DROP TABLE IF EXISTS "ContractPrice" CASCADE;
DROP TABLE IF EXISTS "CatalogItemRelation" CASCADE;
DROP TABLE IF EXISTS "PriceAlertRule" CASCADE;
DROP TABLE IF EXISTS "PriceAlert" CASCADE;
DROP TABLE IF EXISTS "CatalogItem" CASCADE;
DROP TABLE IF EXISTS "CatalogItemAttachment" CASCADE;
DROP TABLE IF EXISTS "CatalogSearchLog" CASCADE;
DROP TABLE IF EXISTS "CatalogSubscription" CASCADE;
DROP TABLE IF EXISTS "BudgetList" CASCADE;
DROP TABLE IF EXISTS "BudgetItem" CASCADE;
DROP TABLE IF EXISTS "PriceHistory" CASCADE;
DROP TABLE IF EXISTS "UserFavorite" CASCADE;
DROP TABLE IF EXISTS "SupplierCatalogApplication" CASCADE;
DROP TABLE IF EXISTS "CatalogSupplier" CASCADE;

-- 2) 外部关系列（列删即连带其索引）
ALTER TABLE "ProcurementProject" DROP COLUMN IF EXISTS "budgetListId";
ALTER TABLE "Prequalification" DROP COLUMN IF EXISTS "catalogCategoryId";
ALTER TABLE "FrameworkAgreement" DROP COLUMN IF EXISTS "catalogCategoryId";

-- 3) catalog 域存量通知（接收人为 staff 审批人，不在 mall 用户级联范围内）
DELETE FROM "Notification" WHERE type IN (
  'CATALOG_APPLICATION', 'CATALOG_PRICE_ALERT', 'PRICE_REVIEW',
  'CATALOG_APPLICATION_APPROVED', 'CATALOG_APPLICATION_REJECTED',
  'CATALOG_APPLICATION_RETURNED', 'CATALOG_CREATED', 'CATALOG_IMPORTED', 'CATALOG_EXPORTED'
);

-- 4) mall 角色用户（其余依赖行经 onDelete Cascade 自动清理；role 为 String 列非 enum）
DELETE FROM "User" WHERE role = 'mall';
