-- #151：废标原因落列（生成时自通过性表决/超限价组装，随结果下发）
ALTER TABLE "BidEvaluationResult" ADD COLUMN "disqualifiedReason" TEXT;
