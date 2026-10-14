-- 2026-10-14 用户裁定：主持端代解密功能整体清除——旧轨授权记录列随之删除
-- （存量 legacy 行仅历史证据读；该列值已无消费方）
ALTER TABLE "SupplierBidSubmission" DROP COLUMN "hostDecryptAuthorized";
