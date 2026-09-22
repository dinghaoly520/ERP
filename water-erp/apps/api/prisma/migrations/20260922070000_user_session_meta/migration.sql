-- 会话设备元数据（2026-09-22）：单设备门户登录/轮换时写入设备分类快照，
-- 供主持人工位视图（核验矩阵）/解锁弹窗展示「当前在线设备」。
ALTER TABLE "User" ADD COLUMN "sessionMeta" JSONB;
