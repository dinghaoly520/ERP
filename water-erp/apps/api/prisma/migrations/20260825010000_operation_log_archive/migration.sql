-- P1-12：操作日志归档清单（archive-before-drop，办法第42条≥15年留存）
CREATE TABLE "OperationLogArchive" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OperationLogArchive_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OperationLogArchive_month_key" ON "OperationLogArchive"("month");
CREATE UNIQUE INDEX "OperationLogArchive_objectKey_key" ON "OperationLogArchive"("objectKey");
CREATE INDEX "OperationLogArchive_archivedAt_idx" ON "OperationLogArchive"("archivedAt");
