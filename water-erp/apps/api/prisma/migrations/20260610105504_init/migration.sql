-- CreateEnum
CREATE TYPE "BidStage" AS ENUM ('DOWNLOAD', 'SUBMIT', 'OPENING', 'EVALUATING', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DecryptStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'DANGER');

-- CreateEnum
CREATE TYPE "ConfirmStatus" AS ENUM ('CONFIRMED', 'PENDING', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "ScoreCategory" AS ENUM ('QUALIFICATION', 'RESPONSIVE', 'BUSINESS', 'TECHNICAL', 'PRICE');

-- CreateEnum
CREATE TYPE "ArchiveStatus" AS ENUM ('ARCHIVED', 'PENDING_CONFIRM', 'NOT_STARTED');

-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('PENDING', 'RETURNED', 'APPROVED', 'REJECTED', 'DISABLED', 'BLACKLIST');

-- CreateEnum
CREATE TYPE "ChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'internal_user',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "departmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidProject" (
    "id" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "procurementMethod" TEXT NOT NULL,
    "openTime" TIMESTAMP(3) NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "stage" "BidStage" NOT NULL DEFAULT 'DOWNLOAD',
    "riskNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BidProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidSupplier" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "downloadStatus" TEXT NOT NULL DEFAULT '待下载',
    "submitStatus" TEXT NOT NULL DEFAULT '待提交',
    "encryptStatus" TEXT NOT NULL DEFAULT '待校验',
    "receiptNo" TEXT,
    "decryptStatus" "DecryptStatus" NOT NULL DEFAULT 'PENDING',
    "confirmStatus" "ConfirmStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BidSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidOpeningSession" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "supervisor" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT '待开标',
    "decryptWindowStart" TIMESTAMP(3) NOT NULL,
    "decryptWindowEnd" TIMESTAMP(3) NOT NULL,
    "remainingSeconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BidOpeningSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidOpeningRecord" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "qualityTarget" TEXT NOT NULL,
    "bondStatus" TEXT NOT NULL,
    "decryptResult" TEXT NOT NULL,
    "confirmStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BidOpeningRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidExpert" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "expertName" TEXT NOT NULL,
    "major" TEXT NOT NULL,
    "signedIn" BOOLEAN NOT NULL DEFAULT false,
    "avoidanceConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "totalScore" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BidExpert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidScoreItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "category" "ScoreCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "maxScore" DECIMAL(5,1) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BidScoreItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidScoreRecord" (
    "id" TEXT NOT NULL,
    "expertId" TEXT NOT NULL,
    "scoreItemId" TEXT NOT NULL,
    "score" DECIMAL(5,1) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BidScoreRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidClarification" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT '待回复',
    "reply" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BidClarification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidSupervisionLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "role" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "riskFlag" TEXT NOT NULL DEFAULT '无',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BidSupervisionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidArchiveItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerRole" TEXT NOT NULL,
    "status" "ArchiveStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "hashDigest" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BidArchiveItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "creditCode" TEXT NOT NULL,
    "enterpriseType" TEXT NOT NULL,
    "legalPerson" TEXT NOT NULL,
    "registeredAddress" TEXT NOT NULL,
    "businessScope" TEXT NOT NULL,
    "status" "SupplierStatus" NOT NULL DEFAULT 'PENDING',
    "classificationId" TEXT,
    "rejectReason" TEXT,
    "returnReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierContact" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierQualification" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT '有效',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierQualification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierClassification" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierClassification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierEvaluation" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "projectId" TEXT,
    "evaluatorId" TEXT NOT NULL,
    "score" DECIMAL(5,1) NOT NULL,
    "level" TEXT NOT NULL,
    "completenessScore" DECIMAL(5,1) NOT NULL,
    "responsivenessScore" DECIMAL(5,1) NOT NULL,
    "cooperationScore" DECIMAL(5,1) NOT NULL,
    "complianceScore" DECIMAL(5,1) NOT NULL,
    "overallScore" DECIMAL(5,1) NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierChangeRecord" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "fieldLabel" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT,
    "status" "ChangeStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierChangeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "link" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "BidProject_projectCode_key" ON "BidProject"("projectCode");

-- CreateIndex
CREATE INDEX "BidProject_stage_idx" ON "BidProject"("stage");

-- CreateIndex
CREATE UNIQUE INDEX "BidSupplier_projectId_supplierName_key" ON "BidSupplier"("projectId", "supplierName");

-- CreateIndex
CREATE UNIQUE INDEX "BidOpeningSession_projectId_key" ON "BidOpeningSession"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_userId_key" ON "Supplier"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_normalizedName_key" ON "Supplier"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_creditCode_key" ON "Supplier"("creditCode");

-- CreateIndex
CREATE INDEX "Supplier_status_idx" ON "Supplier"("status");

-- CreateIndex
CREATE INDEX "Supplier_creditCode_idx" ON "Supplier"("creditCode");

-- CreateIndex
CREATE INDEX "SupplierContact_supplierId_idx" ON "SupplierContact"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierQualification_supplierId_idx" ON "SupplierQualification"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierQualification_validTo_idx" ON "SupplierQualification"("validTo");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierClassification_name_key" ON "SupplierClassification"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierClassification_code_key" ON "SupplierClassification"("code");

-- CreateIndex
CREATE INDEX "SupplierEvaluation_supplierId_idx" ON "SupplierEvaluation"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierEvaluation_evaluatorId_idx" ON "SupplierEvaluation"("evaluatorId");

-- CreateIndex
CREATE INDEX "SupplierChangeRecord_supplierId_idx" ON "SupplierChangeRecord"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierChangeRecord_status_idx" ON "SupplierChangeRecord"("status");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidSupplier" ADD CONSTRAINT "BidSupplier_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidOpeningSession" ADD CONSTRAINT "BidOpeningSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidOpeningRecord" ADD CONSTRAINT "BidOpeningRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidExpert" ADD CONSTRAINT "BidExpert_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidScoreItem" ADD CONSTRAINT "BidScoreItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidScoreRecord" ADD CONSTRAINT "BidScoreRecord_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "BidExpert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidScoreRecord" ADD CONSTRAINT "BidScoreRecord_scoreItemId_fkey" FOREIGN KEY ("scoreItemId") REFERENCES "BidScoreItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidClarification" ADD CONSTRAINT "BidClarification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidSupervisionLog" ADD CONSTRAINT "BidSupervisionLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidArchiveItem" ADD CONSTRAINT "BidArchiveItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "SupplierClassification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierContact" ADD CONSTRAINT "SupplierContact_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQualification" ADD CONSTRAINT "SupplierQualification_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierEvaluation" ADD CONSTRAINT "SupplierEvaluation_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierEvaluation" ADD CONSTRAINT "SupplierEvaluation_evaluatorId_fkey" FOREIGN KEY ("evaluatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierChangeRecord" ADD CONSTRAINT "SupplierChangeRecord_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
