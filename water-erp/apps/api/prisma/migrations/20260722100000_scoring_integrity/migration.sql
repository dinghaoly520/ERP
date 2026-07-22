-- T25: 评分模型完整性约束（P2 组，seed 安全子集）
-- 说明：ExpertEvaluation 唯一约束与种子数据冲突（种子含重复履职评价），改用服务层 createEvaluation upsert 保证幂等，故此处不含该约束。

-- 1. BidScoreItem 同项目重名去重（保留最早）。注意：会级联删除该项的得分点/评分记录
DELETE FROM "BidScoreItem" i
USING "BidScoreItem" i2
WHERE i."projectId" = i2."projectId"
  AND i."name" = i2."name"
  AND i."createdAt" > i2."createdAt";

-- 2. BidScoreRecord 增加 updatedAt 列（评分可改，需最后修改时间）
ALTER TABLE "BidScoreRecord" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now();

-- 3. BidScoreItem 同项目名唯一（防重名致 Σ 校验/模板去重混淆）
ALTER TABLE "BidScoreItem" ADD CONSTRAINT "BidScoreItem_projectId_name_key" UNIQUE ("projectId", "name");
