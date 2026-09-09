-- 对接专项 Phase 2（K1）：幂等三元组收窄为终态占坑——FAILED/STUB_REFUSED 行不再阻断重推。
-- Prisma 不支持 partial index，schema 不建模该约束（刻意偏离，见 schema 内注释）。
DROP INDEX IF EXISTS "PlatformPushLog_channel_itemId_payloadSha256_key"; -- T1 以 UNIQUE INDEX 形态建成（非 constraint），DROP INDEX 才对
CREATE UNIQUE INDEX "PlatformPushLog_idem_success_idx" ON "PlatformPushLog"("channel", "itemId", "payloadSha256") WHERE status IN ('SUCCESS', 'EXPORTED');
