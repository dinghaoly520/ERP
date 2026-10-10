-- 开标地点条目删除「名称」列（2026-10-10 用户裁定：地点只有一个地址，条目以地址标识）
ALTER TABLE "CompanyPlace" DROP COLUMN "label";
