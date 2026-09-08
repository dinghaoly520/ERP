-- P2 A-113/A-147：纯加列（从全量 diff 中人工摘取——库内另有 4 处已知刻意偏离，勿从 diff 重生成整段）
-- AlterTable
ALTER TABLE "BidOpeningRecord" ADD COLUMN     "customFields" JSONB;

-- AlterTable
ALTER TABLE "BidProject" ADD COLUMN     "openingFieldConfig" JSONB;

-- AlterTable
ALTER TABLE "ScoreTemplate" ADD COLUMN     "procurementMethod" TEXT,
ADD COLUMN     "projectCategory" TEXT;

-- CreateIndex
CREATE INDEX "ScoreTemplate_procurementMethod_idx" ON "ScoreTemplate"("procurementMethod");
