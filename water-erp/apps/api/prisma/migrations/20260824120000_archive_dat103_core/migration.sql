-- DA/T 103-2024 归档域基座（定点迁移：不走 migrate dev，因存量漂移会误伤 OperationLog 分区表）
-- 创建：ArchiveScopeItem（归档范围表）/ ArchiveMetadata（档案元数据）/ ArchiveCheckResult（四性检测）
-- PMI 加保管期限与归档包列

CREATE TYPE "ArchiveRetentionPeriod" AS ENUM ('PERMANENT', 'Y30', 'Y10');

CREATE TABLE "ArchiveScopeItem" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "materialName" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "attachmentTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "stageKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "fileCategories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isRequired" BOOLEAN NOT NULL DEFAULT true,
  "keepByTenderer" BOOLEAN NOT NULL DEFAULT true,
  "keepByBidder" BOOLEAN NOT NULL DEFAULT false,
  "keepByAgency" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ArchiveScopeItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ArchiveScopeItem_code_key" ON "ArchiveScopeItem"("code");
CREATE INDEX "ArchiveScopeItem_stage_idx" ON "ArchiveScopeItem"("stage");
CREATE INDEX "ArchiveScopeItem_sourceType_idx" ON "ArchiveScopeItem"("sourceType");

CREATE TABLE "ArchiveMetadata" (
  "id" TEXT NOT NULL,
  "attachmentId" TEXT,
  "fileAssetId" TEXT,
  "title" TEXT,
  "persons" JSONB,
  "responsibles" JSONB,
  "formedAt" TIMESTAMP(3),
  "sourceModule" TEXT,
  "autoCapturedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "scopeItemId" TEXT,
  CONSTRAINT "ArchiveMetadata_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ArchiveMetadata_attachmentId_key" ON "ArchiveMetadata"("attachmentId");
CREATE UNIQUE INDEX "ArchiveMetadata_fileAssetId_key" ON "ArchiveMetadata"("fileAssetId");
CREATE INDEX "ArchiveMetadata_archivedAt_idx" ON "ArchiveMetadata"("archivedAt");
CREATE INDEX "ArchiveMetadata_scopeItemId_idx" ON "ArchiveMetadata"("scopeItemId");
ALTER TABLE "ArchiveMetadata" ADD CONSTRAINT "ArchiveMetadata_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE CASCADE;
ALTER TABLE "ArchiveMetadata" ADD CONSTRAINT "ArchiveMetadata_fileAssetId_fkey" FOREIGN KEY ("fileAssetId") REFERENCES "FileAsset"("id") ON DELETE CASCADE;
ALTER TABLE "ArchiveMetadata" ADD CONSTRAINT "ArchiveMetadata_scopeItemId_fkey" FOREIGN KEY ("scopeItemId") REFERENCES "ArchiveScopeItem"("id");

CREATE TABLE "ArchiveCheckResult" (
  "id" TEXT NOT NULL,
  "pmiId" TEXT NOT NULL,
  "overall" TEXT NOT NULL,
  "passedCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "details" JSONB,
  "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ranById" TEXT,
  CONSTRAINT "ArchiveCheckResult_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ArchiveCheckResult_pmiId_ranAt_idx" ON "ArchiveCheckResult"("pmiId", "ranAt");

ALTER TABLE "ProjectManagementItem" ADD COLUMN "retentionPeriod" "ArchiveRetentionPeriod";
ALTER TABLE "ProjectManagementItem" ADD COLUMN "archiveExportedAt" TIMESTAMP(3);
ALTER TABLE "ProjectManagementItem" ADD COLUMN "archivePackageKey" TEXT;
