-- CreateEnum
CREATE TYPE "AiAnalysisTaskStatus" AS ENUM ('PENDING', 'TENDER_PROCESSING', 'ANALYZING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "AiBidderStatus" ADD VALUE 'CONCORDANCE_CHECKING';

-- DropForeignKey
ALTER TABLE "ai_bidders" DROP CONSTRAINT "ai_bidders_taskId_fkey";

-- DropForeignKey
ALTER TABLE "ai_tender_files" DROP CONSTRAINT "ai_tender_files_taskId_fkey";

-- DropIndex
DROP INDEX "ai_bid_analysis_tasks_createdBy_idx";

-- DropIndex
DROP INDEX "ai_bid_analysis_tasks_projectId_idx";

-- AlterTable
ALTER TABLE "BidScoreItem" ADD COLUMN     "criteriaSource" TEXT,
ADD COLUMN     "evidenceHint" TEXT,
ADD COLUMN     "scoringCriteria" TEXT;

-- AlterTable
ALTER TABLE "ai_bid_analysis_tasks" DROP COLUMN "createdBy",
DROP COLUMN "name",
DROP COLUMN "projectName",
DROP COLUMN "scoringRules",
DROP COLUMN "tenderFileId",
DROP COLUMN "tenderFileName",
ADD COLUMN     "scoringCriteriaSnapshot" JSONB,
DROP COLUMN "status",
ADD COLUMN     "status" "AiAnalysisTaskStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "ai_bid_reports" ADD COLUMN     "concordanceSummary" JSONB;

-- DropTable
DROP TABLE "ai_bidders";

-- DropTable
DROP TABLE "ai_tender_files";

-- DropEnum
DROP TYPE "AiBidTaskStatus";

-- CreateTable
CREATE TABLE "ai_bidder_results" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "bidSupplierId" TEXT NOT NULL,
    "status" "AiBidderStatus" NOT NULL DEFAULT 'PENDING',
    "technicalText" TEXT,
    "businessText" TEXT,
    "extractedInfo" JSONB,
    "systemInfo" JSONB,
    "keyInfo" JSONB,
    "scoreItems" JSONB,
    "categoryTotals" JSONB,
    "totalScore" DECIMAL(5,2),
    "qualificationStatus" TEXT DEFAULT 'pending',
    "riskLevel" TEXT DEFAULT 'low',
    "riskAnalysis" JSONB,
    "strengths" JSONB,
    "weaknesses" JSONB,
    "overallComment" TEXT,
    "deviationAnalysis" JSONB,
    "competitiveAnalysis" JSONB,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_bidder_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_concordance_results" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "bidderResultId" TEXT NOT NULL,
    "overallStatus" TEXT NOT NULL,
    "conflictCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "checkedFields" JSONB,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_concordance_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_bidder_results_taskId_idx" ON "ai_bidder_results"("taskId");

-- CreateIndex
CREATE INDEX "ai_bidder_results_bidSupplierId_idx" ON "ai_bidder_results"("bidSupplierId");

-- CreateIndex
CREATE INDEX "ai_bidder_results_status_idx" ON "ai_bidder_results"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_bidder_results_taskId_bidSupplierId_key" ON "ai_bidder_results"("taskId", "bidSupplierId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_concordance_results_bidderResultId_key" ON "ai_concordance_results"("bidderResultId");

-- CreateIndex
CREATE INDEX "ai_concordance_results_taskId_idx" ON "ai_concordance_results"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_bid_analysis_tasks_projectId_key" ON "ai_bid_analysis_tasks"("projectId");

-- CreateIndex
CREATE INDEX "ai_bid_analysis_tasks_status_idx" ON "ai_bid_analysis_tasks"("status");

-- AddForeignKey
ALTER TABLE "ai_bidder_results" ADD CONSTRAINT "ai_bidder_results_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ai_bid_analysis_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_bidder_results" ADD CONSTRAINT "ai_bidder_results_bidSupplierId_fkey" FOREIGN KEY ("bidSupplierId") REFERENCES "BidSupplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_concordance_results" ADD CONSTRAINT "ai_concordance_results_bidderResultId_fkey" FOREIGN KEY ("bidderResultId") REFERENCES "ai_bidder_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_concordance_results" ADD CONSTRAINT "ai_concordance_results_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ai_bid_analysis_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

