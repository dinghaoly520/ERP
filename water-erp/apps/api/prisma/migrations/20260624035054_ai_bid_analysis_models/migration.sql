-- CreateEnum
CREATE TYPE "AiBidTaskStatus" AS ENUM ('CREATED', 'TENDER_UPLOADING', 'TENDER_PROCESSING', 'TENDER_READY', 'RULES_PREVIEW', 'BIDDERS_UPLOADING', 'BIDDERS_PROCESSING', 'ANALYZING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AiBidderStatus" AS ENUM ('PENDING', 'OCR_PROCESSING', 'OCR_COMPLETED', 'EXTRACTING', 'EXTRACTED', 'SCORING', 'SCORED', 'DEVIATION_ANALYZING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "ai_bid_analysis_tasks" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectName" TEXT,
    "tenderFileId" TEXT,
    "tenderFileName" TEXT,
    "tenderText" TEXT,
    "tenderPages" JSONB,
    "requirements" JSONB,
    "scoringRules" JSONB,
    "status" "AiBidTaskStatus" NOT NULL DEFAULT 'CREATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ai_bid_analysis_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_tender_files" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "text" TEXT,
    "pages" JSONB,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_tender_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_bidders" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileName" TEXT,
    "fileId" TEXT,
    "text" TEXT,
    "pages" JSONB,
    "extractedInfo" JSONB,
    "keyInfo" JSONB,
    "deviationAnalysis" JSONB,
    "scores" JSONB,
    "totalScore" DECIMAL(5,2),
    "qualificationStatus" TEXT DEFAULT 'pending',
    "riskLevel" TEXT DEFAULT 'low',
    "riskAnalysis" JSONB,
    "analysis" TEXT,
    "strengths" JSONB,
    "weaknesses" JSONB,
    "overallComment" TEXT,
    "status" "AiBidderStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "competitiveAnalysis" JSONB,

    CONSTRAINT "ai_bidders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_bid_reports" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "summary" JSONB,
    "ranking" JSONB,
    "keyInfoComparison" JSONB,
    "priceAnalysis" JSONB,
    "strengthsWeaknesses" JSONB,
    "riskStats" JSONB,
    "highRiskDetails" JSONB,
    "reviewSuggestions" JSONB,
    "fraudIndicators" JSONB,
    "conclusion" TEXT,
    "recommendation" JSONB,
    "docxFileId" TEXT,
    "pdfFileId" TEXT,
    "generatedAt" TIMESTAMP(3),

    CONSTRAINT "ai_bid_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_bid_analysis_tasks_status_idx" ON "ai_bid_analysis_tasks"("status");

-- CreateIndex
CREATE INDEX "ai_bid_analysis_tasks_projectId_idx" ON "ai_bid_analysis_tasks"("projectId");

-- CreateIndex
CREATE INDEX "ai_bid_analysis_tasks_createdBy_idx" ON "ai_bid_analysis_tasks"("createdBy");

-- CreateIndex
CREATE INDEX "ai_tender_files_taskId_idx" ON "ai_tender_files"("taskId");

-- CreateIndex
CREATE INDEX "ai_bidders_taskId_idx" ON "ai_bidders"("taskId");

-- CreateIndex
CREATE INDEX "ai_bidders_status_idx" ON "ai_bidders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_bid_reports_taskId_key" ON "ai_bid_reports"("taskId");

-- AddForeignKey
ALTER TABLE "ai_bid_analysis_tasks" ADD CONSTRAINT "ai_bid_analysis_tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_tender_files" ADD CONSTRAINT "ai_tender_files_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ai_bid_analysis_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_bidders" ADD CONSTRAINT "ai_bidders_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ai_bid_analysis_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_bid_reports" ADD CONSTRAINT "ai_bid_reports_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ai_bid_analysis_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
