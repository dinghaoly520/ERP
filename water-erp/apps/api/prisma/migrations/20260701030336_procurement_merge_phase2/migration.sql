/*
  Warnings:

  - You are about to drop the column `detail` on the `AuditLog` table. All the data in the column will be lost.
  - You are about to drop the column `target` on the `AuditLog` table. All the data in the column will be lost.
  - You are about to drop the `AssistantConversation` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AssistantMessage` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `resourceType` to the `AuditLog` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ResultStatus" AS ENUM ('AWARDED', 'FAILED_REVIEW', 'FILE_REVISION_REQUIRED', 'INVALID_RESPONSE', 'PENDING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('EXCEL_IMPORT', 'MANUAL', 'PROJECT_MANAGEMENT');

-- CreateEnum
CREATE TYPE "AttachmentType" AS ENUM ('TENDER_DOCUMENT', 'REVIEW_COMMENT', 'BID_ANALYSIS', 'AWARD_NOTICE', 'CONTRACT', 'SUPPORTING_MATERIAL');

-- CreateEnum
CREATE TYPE "PasswordChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProjectManagementStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'RECYCLED');

-- CreateEnum
CREATE TYPE "ProjectStageStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "WorkArrangementStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkArrangementType" AS ENUM ('APPROVAL', 'FOLLOW_UP', 'WRITING', 'COMMUNICATION', 'REVIEW', 'ARCHIVE', 'RESEARCH', 'MEETING', 'OTHER');

-- CreateEnum
CREATE TYPE "WorkArrangementUrgency" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "WorkArrangementRecurrence" AS ENUM ('NONE', 'DAILY', 'WEEKDAYS', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "WorkArrangementNoteType" AS ENUM ('PROGRESS', 'INSIGHT');

-- DropForeignKey
ALTER TABLE "AssistantMessage" DROP CONSTRAINT "AssistantMessage_conversationId_fkey";

-- AlterTable
ALTER TABLE "AuditLog" DROP COLUMN "detail",
DROP COLUMN "target",
ADD COLUMN     "details" JSONB,
ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "resourceId" TEXT,
ADD COLUMN     "resourceType" TEXT NOT NULL,
ADD COLUMN     "userAgent" TEXT;

-- DropTable
DROP TABLE "AssistantConversation";

-- DropTable
DROP TABLE "AssistantMessage";

-- CreateTable
CREATE TABLE "assistant_conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT DEFAULT '新对话',
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" JSONB,
    "toolResult" JSONB,
    "actions" JSONB,
    "cardsJson" JSONB,
    "citationsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_alerts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'system',
    "defaultHomePage" TEXT NOT NULL DEFAULT 'dashboard',
    "compactMode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "projectCode" TEXT,
    "name" TEXT NOT NULL,
    "businessCategory" TEXT,
    "description" TEXT,
    "requestingDepartmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcurementRound" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "roundNo" INTEGER NOT NULL,
    "procurementDate" TIMESTAMP(3),
    "procurementMethod" TEXT NOT NULL,
    "departmentId" TEXT,
    "budgetAmount" DECIMAL(14,2),
    "controlAmount" DECIMAL(14,2),
    "awardedSupplierId" TEXT,
    "awardAmount" DECIMAL(14,2),
    "resultStatus" "ResultStatus" NOT NULL DEFAULT 'PENDING',
    "resultText" TEXT,
    "sourceType" "SourceType" NOT NULL DEFAULT 'MANUAL',
    "supplierText" TEXT,
    "importBatchId" TEXT,
    "isRecycled" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "awardedSupplierName" TEXT,
    "expertInfo" TEXT,
    "biddingUnits" TEXT,
    "procurementProjectId" TEXT,

    CONSTRAINT "ProcurementRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoundParticipant" (
    "id" TEXT NOT NULL,
    "procurementRoundId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "sequenceNo" INTEGER,
    "participationRole" TEXT,

    CONSTRAINT "RoundParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "procurementRoundId" TEXT,
    "attachmentType" "AttachmentType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectManagementItemId" TEXT,
    "projectManagementStageId" TEXT,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectManagementItem" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "requesterName" TEXT NOT NULL,
    "requesterDepartment" TEXT NOT NULL,
    "procurementMethod" TEXT NOT NULL,
    "procurementCategory" TEXT NOT NULL,
    "procurementOrganizationForm" TEXT NOT NULL,
    "budgetAmount" DECIMAL(14,2) NOT NULL,
    "isAnnualBudget" BOOLEAN NOT NULL,
    "projectReason" TEXT NOT NULL,
    "supplierRequirements" TEXT NOT NULL,
    "currentStage" TEXT NOT NULL,
    "status" "ProjectManagementStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedProcurementRoundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "analysisSummary" TEXT,
    "analysisUpdatedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "initiationDate" TIMESTAMP(3),
    "evaluationMethod" TEXT,
    "expertInfo" TEXT,
    "biddingUnits" TEXT,
    "awardedSupplier" TEXT,
    "contractAmount" DECIMAL(14,2),
    "archivedAt" TIMESTAMP(3),
    "archiveHook" TEXT,
    "hasProcurementDemand" BOOLEAN NOT NULL DEFAULT false,
    "demandRequesterName" TEXT,
    "demandDepartment" TEXT,
    "demandProcurementTitle" TEXT,
    "demandProjectReason" TEXT,
    "demandSupplierReqs" TEXT,
    "demandBudgetAmount" DECIMAL(14,2),
    "demandProcurementCategory" TEXT,
    "demandProcurementMethod" TEXT,
    "demandProject" TEXT,
    "demandContractNumber" TEXT,
    "contractNumber" TEXT,
    "departmentNumber" TEXT,

    CONSTRAINT "ProjectManagementItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectManagementStage" (
    "id" TEXT NOT NULL,
    "projectManagementItemId" TEXT NOT NULL,
    "stageKey" TEXT NOT NULL,
    "stageName" TEXT NOT NULL,
    "stageOrder" INTEGER NOT NULL,
    "status" "ProjectStageStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "note" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectManagementStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sourceMonth" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkArrangement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "WorkArrangementType" NOT NULL,
    "urgency" "WorkArrangementUrgency" NOT NULL DEFAULT 'MEDIUM',
    "status" "WorkArrangementStatus" NOT NULL DEFAULT 'TODO',
    "dueAt" TIMESTAMP(3),
    "reminderAt" TIMESTAMP(3),
    "estimatedMinutes" INTEGER,
    "isAllDay" BOOLEAN NOT NULL DEFAULT true,
    "customTags" JSONB,
    "recurrence" "WorkArrangementRecurrence" NOT NULL DEFAULT 'NONE',
    "projectManagementItemId" TEXT,
    "templateId" TEXT,
    "completionSummary" TEXT,
    "reflectionSummary" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkArrangement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkArrangementNote" (
    "id" TEXT NOT NULL,
    "workArrangementId" TEXT NOT NULL,
    "type" "WorkArrangementNoteType" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkArrangementNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkArrangementTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "WorkArrangementType" NOT NULL,
    "urgency" "WorkArrangementUrgency" NOT NULL DEFAULT 'MEDIUM',
    "estimatedMinutes" INTEGER,
    "isAllDay" BOOLEAN NOT NULL DEFAULT true,
    "customTags" JSONB,
    "recurrence" "WorkArrangementRecurrence" NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkArrangementTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkArrangementDependency" (
    "workArrangementId" TEXT NOT NULL,
    "dependsOnId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkArrangementDependency_pkey" PRIMARY KEY ("workArrangementId","dependsOnId")
);

-- CreateTable
CREATE TABLE "PasswordChangeRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestedPasswordHash" TEXT NOT NULL,
    "status" "PasswordChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decisionNote" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "approvedById" TEXT,

    CONSTRAINT "PasswordChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetRequest" (
    "id" TEXT NOT NULL,
    "requestedUsername" TEXT NOT NULL,
    "applicantName" TEXT NOT NULL,
    "applicantContact" TEXT NOT NULL,
    "matchedUserId" TEXT,
    "status" "PasswordChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decisionNote" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,

    CONSTRAINT "PasswordResetRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeBase" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeBase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeFile" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "content" TEXT,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "collectionName" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceRule" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL,
    "checkTarget" TEXT NOT NULL,
    "logicExpression" JSONB NOT NULL,
    "severity" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewTask" (
    "id" TEXT NOT NULL,
    "documentName" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "documentContent" TEXT,
    "knowledgeBaseId" TEXT,
    "reviewMode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "totalChecks" INTEGER NOT NULL DEFAULT 0,
    "passedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "results" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "modifiedDocumentContent" TEXT,
    "userId" TEXT,

    CONSTRAINT "ReviewTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderFieldSample" (
    "id" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "sourceType" TEXT NOT NULL DEFAULT 'manual',
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenderFieldSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderDocumentHistory" (
    "id" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "draftData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "contentHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "TenderDocumentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionTask" (
    "id" TEXT NOT NULL,
    "knowledgeBaseId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "extractedCount" INTEGER NOT NULL DEFAULT 0,
    "processedFiles" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractionTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_messages_conversationId_createdAt_idx" ON "assistant_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "assistant_alerts_userId_dismissed_createdAt_idx" ON "assistant_alerts"("userId", "dismissed", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_projectCode_key" ON "Project"("projectCode");

-- CreateIndex
CREATE INDEX "Project_name_idx" ON "Project"("name");

-- CreateIndex
CREATE INDEX "ProcurementRound_procurementDate_idx" ON "ProcurementRound"("procurementDate");

-- CreateIndex
CREATE INDEX "ProcurementRound_procurementMethod_idx" ON "ProcurementRound"("procurementMethod");

-- CreateIndex
CREATE INDEX "ProcurementRound_resultStatus_idx" ON "ProcurementRound"("resultStatus");

-- CreateIndex
CREATE INDEX "ProcurementRound_isRecycled_idx" ON "ProcurementRound"("isRecycled");

-- CreateIndex
CREATE INDEX "ProcurementRound_procurementProjectId_idx" ON "ProcurementRound"("procurementProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcurementRound_projectId_roundNo_key" ON "ProcurementRound"("projectId", "roundNo");

-- CreateIndex
CREATE UNIQUE INDEX "RoundParticipant_procurementRoundId_supplierId_key" ON "RoundParticipant"("procurementRoundId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_objectKey_key" ON "Attachment"("objectKey");

-- CreateIndex
CREATE INDEX "Attachment_attachmentType_idx" ON "Attachment"("attachmentType");

-- CreateIndex
CREATE INDEX "Attachment_projectManagementItemId_idx" ON "Attachment"("projectManagementItemId");

-- CreateIndex
CREATE INDEX "Attachment_projectManagementStageId_idx" ON "Attachment"("projectManagementStageId");

-- CreateIndex
CREATE INDEX "ProjectManagementItem_status_currentStage_idx" ON "ProjectManagementItem"("status", "currentStage");

-- CreateIndex
CREATE INDEX "ProjectManagementItem_title_idx" ON "ProjectManagementItem"("title");

-- CreateIndex
CREATE INDEX "ProjectManagementItem_createdById_idx" ON "ProjectManagementItem"("createdById");

-- CreateIndex
CREATE INDEX "ProjectManagementStage_projectManagementItemId_stageOrder_idx" ON "ProjectManagementStage"("projectManagementItemId", "stageOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectManagementStage_projectManagementItemId_stageKey_key" ON "ProjectManagementStage"("projectManagementItemId", "stageKey");

-- CreateIndex
CREATE INDEX "WorkArrangement_userId_status_dueAt_idx" ON "WorkArrangement"("userId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "WorkArrangement_userId_urgency_dueAt_idx" ON "WorkArrangement"("userId", "urgency", "dueAt");

-- CreateIndex
CREATE INDEX "WorkArrangement_projectManagementItemId_dueAt_idx" ON "WorkArrangement"("projectManagementItemId", "dueAt");

-- CreateIndex
CREATE INDEX "WorkArrangementNote_workArrangementId_createdAt_idx" ON "WorkArrangementNote"("workArrangementId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkArrangementTemplate_userId_updatedAt_idx" ON "WorkArrangementTemplate"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "WorkArrangementDependency_dependsOnId_idx" ON "WorkArrangementDependency"("dependsOnId");

-- CreateIndex
CREATE INDEX "PasswordChangeRequest_userId_status_idx" ON "PasswordChangeRequest"("userId", "status");

-- CreateIndex
CREATE INDEX "PasswordChangeRequest_status_requestedAt_idx" ON "PasswordChangeRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "PasswordResetRequest_requestedUsername_status_idx" ON "PasswordResetRequest"("requestedUsername", "status");

-- CreateIndex
CREATE INDEX "PasswordResetRequest_matchedUserId_status_idx" ON "PasswordResetRequest"("matchedUserId", "status");

-- CreateIndex
CREATE INDEX "PasswordResetRequest_status_requestedAt_idx" ON "PasswordResetRequest"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "KnowledgeFile_knowledgeBaseId_idx" ON "KnowledgeFile"("knowledgeBaseId");

-- CreateIndex
CREATE INDEX "DocumentChunk_collectionName_idx" ON "DocumentChunk"("collectionName");

-- CreateIndex
CREATE INDEX "ComplianceRule_knowledgeBaseId_idx" ON "ComplianceRule"("knowledgeBaseId");

-- CreateIndex
CREATE INDEX "ComplianceRule_ruleType_idx" ON "ComplianceRule"("ruleType");

-- CreateIndex
CREATE INDEX "ReviewTask_knowledgeBaseId_idx" ON "ReviewTask"("knowledgeBaseId");

-- CreateIndex
CREATE INDEX "ReviewTask_status_idx" ON "ReviewTask"("status");

-- CreateIndex
CREATE INDEX "ReviewTask_userId_idx" ON "ReviewTask"("userId");

-- CreateIndex
CREATE INDEX "TenderFieldSample_fieldKey_isFavorite_idx" ON "TenderFieldSample"("fieldKey", "isFavorite");

-- CreateIndex
CREATE INDEX "TenderFieldSample_fieldKey_createdAt_idx" ON "TenderFieldSample"("fieldKey", "createdAt");

-- CreateIndex
CREATE INDEX "Contact_name_idx" ON "Contact"("name");

-- CreateIndex
CREATE INDEX "TenderDocumentHistory_documentType_createdAt_idx" ON "TenderDocumentHistory"("documentType", "createdAt");

-- CreateIndex
CREATE INDEX "TenderDocumentHistory_userId_createdAt_idx" ON "TenderDocumentHistory"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TenderDocumentHistory_userId_documentType_contentHash_key" ON "TenderDocumentHistory"("userId", "documentType", "contentHash");

-- CreateIndex
CREATE INDEX "ExtractionTask_status_idx" ON "ExtractionTask"("status");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "assistant_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_alerts" ADD CONSTRAINT "assistant_alerts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_requestingDepartmentId_fkey" FOREIGN KEY ("requestingDepartmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementRound" ADD CONSTRAINT "ProcurementRound_awardedSupplierId_fkey" FOREIGN KEY ("awardedSupplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementRound" ADD CONSTRAINT "ProcurementRound_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementRound" ADD CONSTRAINT "ProcurementRound_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementRound" ADD CONSTRAINT "ProcurementRound_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementRound" ADD CONSTRAINT "ProcurementRound_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementRound" ADD CONSTRAINT "ProcurementRound_procurementProjectId_fkey" FOREIGN KEY ("procurementProjectId") REFERENCES "ProcurementProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcurementRound" ADD CONSTRAINT "ProcurementRound_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundParticipant" ADD CONSTRAINT "RoundParticipant_procurementRoundId_fkey" FOREIGN KEY ("procurementRoundId") REFERENCES "ProcurementRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundParticipant" ADD CONSTRAINT "RoundParticipant_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_procurementRoundId_fkey" FOREIGN KEY ("procurementRoundId") REFERENCES "ProcurementRound"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_projectManagementItemId_fkey" FOREIGN KEY ("projectManagementItemId") REFERENCES "ProjectManagementItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_projectManagementStageId_fkey" FOREIGN KEY ("projectManagementStageId") REFERENCES "ProjectManagementStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectManagementItem" ADD CONSTRAINT "ProjectManagementItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectManagementStage" ADD CONSTRAINT "ProjectManagementStage_projectManagementItemId_fkey" FOREIGN KEY ("projectManagementItemId") REFERENCES "ProjectManagementItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkArrangement" ADD CONSTRAINT "WorkArrangement_projectManagementItemId_fkey" FOREIGN KEY ("projectManagementItemId") REFERENCES "ProjectManagementItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkArrangement" ADD CONSTRAINT "WorkArrangement_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorkArrangementTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkArrangement" ADD CONSTRAINT "WorkArrangement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkArrangementNote" ADD CONSTRAINT "WorkArrangementNote_workArrangementId_fkey" FOREIGN KEY ("workArrangementId") REFERENCES "WorkArrangement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkArrangementTemplate" ADD CONSTRAINT "WorkArrangementTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkArrangementDependency" ADD CONSTRAINT "WorkArrangementDependency_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "WorkArrangement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkArrangementDependency" ADD CONSTRAINT "WorkArrangementDependency_workArrangementId_fkey" FOREIGN KEY ("workArrangementId") REFERENCES "WorkArrangement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordChangeRequest" ADD CONSTRAINT "PasswordChangeRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordChangeRequest" ADD CONSTRAINT "PasswordChangeRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetRequest" ADD CONSTRAINT "PasswordResetRequest_matchedUserId_fkey" FOREIGN KEY ("matchedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetRequest" ADD CONSTRAINT "PasswordResetRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeFile" ADD CONSTRAINT "KnowledgeFile_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceRule" ADD CONSTRAINT "ComplianceRule_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewTask" ADD CONSTRAINT "ReviewTask_knowledgeBaseId_fkey" FOREIGN KEY ("knowledgeBaseId") REFERENCES "KnowledgeBase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewTask" ADD CONSTRAINT "ReviewTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenderDocumentHistory" ADD CONSTRAINT "TenderDocumentHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
