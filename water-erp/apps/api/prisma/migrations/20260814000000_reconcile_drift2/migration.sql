-- 对账迁移（reconcile drift #2）：补齐多会话改 schema 未建迁移的缺口
-- 覆盖：badge 系统（BadgeDefinition/UserBadge/User.company）、供应商邀请码、
--       目录版本/询价/合同价/价格告警、供应商分类关联表，及十余处列级 ALTER。
-- 刻意排除（勿再生成）：
--   1. OperationLog 单列 PK —— 分区表设计 PK=(id, createdAt)，schema 单 @id 为已知偏差
--   2. DROP INDEX BidProject_assignedHostUserId_idx / BidSupplierNudge_status_sendAt_idx
--      —— 手写迁移超集索引，schema 从未建模（20260806000000 / 20260731000000）
--   3. DROP INDEX DocumentChunk_embedding_idx —— pgvector 手工基建索引（tender-review RAG）
-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('ACTIVE', 'USED', 'EXPIRED', 'REVOKED');

-- DropForeignKey
ALTER TABLE "AwardLetterDelivery" DROP CONSTRAINT "AwardLetterDelivery_projectId_fkey";

-- DropForeignKey
ALTER TABLE "BidMotion" DROP CONSTRAINT "BidMotion_projectId_fkey";

-- DropForeignKey
ALTER TABLE "BidQuote" DROP CONSTRAINT "BidQuote_roundId_fkey";

-- DropForeignKey
ALTER TABLE "BidRound" DROP CONSTRAINT "BidRound_projectId_fkey";

-- DropForeignKey
ALTER TABLE "BidVote" DROP CONSTRAINT "BidVote_motionId_fkey";

-- DropForeignKey
ALTER TABLE "ExpertDispute" DROP CONSTRAINT "ExpertDispute_projectId_fkey";




-- DropIndex
DROP INDEX "ProjectManagementStage_projectManagementItemId_stageKey_key";

-- AlterTable
ALTER TABLE "BidEvaluationResult" ADD COLUMN     "bidPrice" DECIMAL(15,2);

-- AlterTable
ALTER TABLE "BidInvalidBid" ADD COLUMN     "actorId" TEXT,
ADD COLUMN     "motionId" TEXT,
ADD COLUMN     "reason" TEXT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "BidOpeningSession" ADD COLUMN     "pauseReason" TEXT;

-- AlterTable
ALTER TABLE "BidSupplier" ADD COLUMN     "lastDownloadAt" TIMESTAMP(3),
ALTER COLUMN "bidValidity" DROP NOT NULL,
ALTER COLUMN "bidValidity" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CatalogItem" ADD COLUMN     "lifecycleStage" TEXT NOT NULL DEFAULT '有效',
ADD COLUMN     "nationalStandard" TEXT;

-- AlterTable
ALTER TABLE "ExpertMemo" ADD COLUMN     "scorePointId" TEXT;

-- AlterTable
ALTER TABLE "ExpertProfile" ADD COLUMN     "retireIgnoredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "FileAsset" ADD COLUMN     "clientEncrypted" BOOLEAN NOT NULL DEFAULT false;


-- AlterTable
ALTER TABLE "ProjectManagementItem" ADD COLUMN     "bidOpeningTime" TEXT,
ADD COLUMN     "currentRound" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "invitedSuppliers" TEXT,
ADD COLUMN     "paymentPerformance" TEXT,
ADD COLUMN     "projectCode" TEXT,
ADD COLUMN     "projectOverview" TEXT;

-- AlterTable
ALTER TABLE "ProjectManagementStage" ADD COLUMN     "round" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "isTemporary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "temporaryExpiresAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SupplierContact" ADD COLUMN     "position" TEXT;

-- AlterTable
ALTER TABLE "SupplierDocument" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SupplierEvaluation" ADD COLUMN     "evidence" JSONB;

-- AlterTable
ALTER TABLE "SupplierFavorite" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatar" TEXT,
ADD COLUMN     "company" TEXT;

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "notificationPrefs" JSONB;

-- CreateTable
CREATE TABLE "SupplierInvitation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "validityDays" INTEGER NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "boundCreditCode" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedById" TEXT,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "SupplierInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierClassificationLink" (
    "supplierId" TEXT NOT NULL,
    "classificationId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierClassificationLink_pkey" PRIMARY KEY ("supplierId","classificationId")
);

-- CreateTable
CREATE TABLE "CatalogVersion" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "CatalogVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogInquiry" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "items" JSONB NOT NULL,
    "supplierIds" TEXT[],
    "deadlineAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "CatalogInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractPrice" (
    "id" SERIAL NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "contractNo" TEXT NOT NULL,
    "agreedPrice" DOUBLE PRECISION NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogItemRelation" (
    "id" SERIAL NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "relatedItemId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogItemRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceAlertRule" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" INTEGER,
    "alertType" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyRoles" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceAlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceAlert" (
    "id" SERIAL NOT NULL,
    "ruleId" INTEGER NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "triggerValue" DOUBLE PRECISION NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogItemAttachment" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogItemAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogSearchLog" (
    "id" SERIAL NOT NULL,
    "keyword" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogSearchLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogSubscription" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BadgeDefinition" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "iconKey" TEXT NOT NULL,
    "levelThresholds" JSONB NOT NULL,
    "unit" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BadgeDefinition_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "UserBadge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "badgeCode" TEXT NOT NULL,
    "currentValue" INTEGER NOT NULL DEFAULT 0,
    "currentLevel" TEXT,
    "awardedLevels" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserBadge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvitation_code_key" ON "SupplierInvitation"("code");

-- CreateIndex
CREATE INDEX "SupplierInvitation_status_idx" ON "SupplierInvitation"("status");

-- CreateIndex
CREATE INDEX "SupplierInvitation_createdById_idx" ON "SupplierInvitation"("createdById");

-- CreateIndex
CREATE INDEX "CatalogVersion_status_idx" ON "CatalogVersion"("status");

-- CreateIndex
CREATE INDEX "CatalogInquiry_status_idx" ON "CatalogInquiry"("status");

-- CreateIndex
CREATE INDEX "ContractPrice_catalogItemId_idx" ON "ContractPrice"("catalogItemId");

-- CreateIndex
CREATE INDEX "ContractPrice_supplierId_idx" ON "ContractPrice"("supplierId");

-- CreateIndex
CREATE INDEX "ContractPrice_validUntil_idx" ON "ContractPrice"("validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItemRelation_catalogItemId_relatedItemId_relationTyp_key" ON "CatalogItemRelation"("catalogItemId", "relatedItemId", "relationType");

-- CreateIndex
CREATE INDEX "PriceAlertRule_categoryId_idx" ON "PriceAlertRule"("categoryId");

-- CreateIndex
CREATE INDEX "PriceAlert_catalogItemId_idx" ON "PriceAlert"("catalogItemId");

-- CreateIndex
CREATE INDEX "PriceAlert_isRead_isResolved_idx" ON "PriceAlert"("isRead", "isResolved");

-- CreateIndex
CREATE INDEX "CatalogItemAttachment_catalogItemId_idx" ON "CatalogItemAttachment"("catalogItemId");

-- CreateIndex
CREATE INDEX "CatalogSearchLog_keyword_idx" ON "CatalogSearchLog"("keyword");

-- CreateIndex
CREATE INDEX "CatalogSearchLog_createdAt_idx" ON "CatalogSearchLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogSubscription_userId_catalogItemId_key" ON "CatalogSubscription"("userId", "catalogItemId");

-- CreateIndex
CREATE INDEX "UserBadge_userId_idx" ON "UserBadge"("userId");

-- CreateIndex
CREATE INDEX "UserBadge_badgeCode_idx" ON "UserBadge"("badgeCode");

-- CreateIndex
CREATE UNIQUE INDEX "UserBadge_userId_badgeCode_key" ON "UserBadge"("userId", "badgeCode");

-- CreateIndex
CREATE INDEX "BidQuote_bidSupplierId_idx" ON "BidQuote"("bidSupplierId");

-- CreateIndex
CREATE INDEX "ExpertMemo_scorePointId_idx" ON "ExpertMemo"("scorePointId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectManagementItem_projectCode_key" ON "ProjectManagementItem"("projectCode");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectManagementStage_projectManagementItemId_stageKey_rou_key" ON "ProjectManagementStage"("projectManagementItemId", "stageKey", "round");

-- AddForeignKey
ALTER TABLE "BidProject" ADD CONSTRAINT "BidProject_projectManagementItemId_fkey" FOREIGN KEY ("projectManagementItemId") REFERENCES "ProjectManagementItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpertMemo" ADD CONSTRAINT "ExpertMemo_scorePointId_fkey" FOREIGN KEY ("scorePointId") REFERENCES "BidScorePoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AwardLetterDelivery" ADD CONSTRAINT "AwardLetterDelivery_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidRound" ADD CONSTRAINT "BidRound_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidQuote" ADD CONSTRAINT "BidQuote_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "BidRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidQuote" ADD CONSTRAINT "BidQuote_bidSupplierId_fkey" FOREIGN KEY ("bidSupplierId") REFERENCES "BidSupplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidMotion" ADD CONSTRAINT "BidMotion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidVote" ADD CONSTRAINT "BidVote_motionId_fkey" FOREIGN KEY ("motionId") REFERENCES "BidMotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpertDispute" ADD CONSTRAINT "ExpertDispute_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvitation" ADD CONSTRAINT "SupplierInvitation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvitation" ADD CONSTRAINT "SupplierInvitation_usedById_fkey" FOREIGN KEY ("usedById") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierClassificationLink" ADD CONSTRAINT "SupplierClassificationLink_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierClassificationLink" ADD CONSTRAINT "SupplierClassificationLink_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "SupplierClassification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogVersion" ADD CONSTRAINT "CatalogVersion_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogInquiry" ADD CONSTRAINT "CatalogInquiry_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractPrice" ADD CONSTRAINT "ContractPrice_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractPrice" ADD CONSTRAINT "ContractPrice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItemRelation" ADD CONSTRAINT "CatalogItemRelation_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItemRelation" ADD CONSTRAINT "CatalogItemRelation_relatedItemId_fkey" FOREIGN KEY ("relatedItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceAlertRule" ADD CONSTRAINT "PriceAlertRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CatalogCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceAlert" ADD CONSTRAINT "PriceAlert_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "PriceAlertRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceAlert" ADD CONSTRAINT "PriceAlert_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItemAttachment" ADD CONSTRAINT "CatalogItemAttachment_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogSubscription" ADD CONSTRAINT "CatalogSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogSubscription" ADD CONSTRAINT "CatalogSubscription_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_badgeCode_fkey" FOREIGN KEY ("badgeCode") REFERENCES "BadgeDefinition"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

