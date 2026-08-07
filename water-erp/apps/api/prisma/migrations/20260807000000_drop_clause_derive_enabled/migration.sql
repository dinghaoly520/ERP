-- 放权给专家：移除管理端 clauseDeriveEnabled 开关（派生改为专家按需触发）
ALTER TABLE "BidProject" DROP COLUMN IF EXISTS "clauseDeriveEnabled";
