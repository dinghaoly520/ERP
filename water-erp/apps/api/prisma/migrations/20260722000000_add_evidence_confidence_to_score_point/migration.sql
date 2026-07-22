-- AlterTable: BidScorePoint 加 evidenceSection + confidence（AI 提取审核依据留痕）
ALTER TABLE "BidScorePoint" ADD COLUMN "evidenceSection" TEXT;
ALTER TABLE "BidScorePoint" ADD COLUMN "confidence" DECIMAL(3,2);
