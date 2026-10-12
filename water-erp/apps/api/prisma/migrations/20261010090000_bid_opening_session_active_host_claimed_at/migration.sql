-- 评标主持人操作权 TTL（P2-5，第四波）：claim 时写占用时点，超时（15min）可被他人惰性接管
-- ——会话死亡后标记残留不再恒占（claimActiveHost where 加 TTL 谓词，免 cron）
ALTER TABLE "BidOpeningSession" ADD COLUMN "activeHostClaimedAt" TIMESTAMP(3);
