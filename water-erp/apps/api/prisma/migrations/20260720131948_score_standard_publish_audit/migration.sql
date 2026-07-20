-- 评分标准发布时间戳 + 监督日志操作员审计
-- BidProject.scoreStandardPublishedAt: 评分标准编制完成后发布(锁定)的时间戳
-- BidSupervisionLog.operatorId / operatorRole: 操作员回写(用于关键动作追溯)
-- 三字段均可空,不破坏既有数据。

ALTER TABLE "BidProject" ADD COLUMN "scoreStandardPublishedAt" TIMESTAMP(3);

ALTER TABLE "BidSupervisionLog" ADD COLUMN "operatorId" TEXT,
                              ADD COLUMN "operatorRole" TEXT;
