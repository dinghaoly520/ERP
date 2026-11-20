-- P3-28（2026-11-20 用户裁定删除）：claim-host「主持人操作权互斥」机制整体移除
-- 机制 2026-07-29（892b64616）引入后前端从未接线、activeHostId 不被任何业务写路径检查；
-- 金仓环境 migrate dev shadow 不可用（gen_random_uuid 缺失），走 db execute + resolve 配方。
ALTER TABLE "BidOpeningSession" DROP COLUMN "activeHostId";
ALTER TABLE "BidOpeningSession" DROP COLUMN "activeHostName";
ALTER TABLE "BidOpeningSession" DROP COLUMN "activeHostClaimedAt";
