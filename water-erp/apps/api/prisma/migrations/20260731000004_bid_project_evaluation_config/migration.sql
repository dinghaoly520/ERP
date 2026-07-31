-- AlterTable: P1/P2 价格分公式引擎 — BidProject 加控制价/评标办法/公式配置
ALTER TABLE "BidProject" ADD COLUMN "ceilingPrice" DECIMAL(14,2);
ALTER TABLE "BidProject" ADD COLUMN "evaluationMethod" TEXT;
ALTER TABLE "BidProject" ADD COLUMN "priceFormulaConfig" JSONB;
