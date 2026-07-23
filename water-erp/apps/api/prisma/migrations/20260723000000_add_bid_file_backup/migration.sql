CREATE TABLE "BidFileBackup" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "fileAssetId" TEXT NOT NULL,
    "fileRole" TEXT NOT NULL,
    "backupKey" TEXT NOT NULL,
    "sealedPath" TEXT NOT NULL,
    "wrappedDek" TEXT NOT NULL,
    "ciphertextSha256" TEXT NOT NULL,
    "plaintextSha256" TEXT,
    "size" INTEGER NOT NULL,
    "receiptNo" TEXT,
    "backupSource" TEXT NOT NULL DEFAULT 'submission',
    "cryptoVersion" TEXT NOT NULL DEFAULT 'envelope-v1',
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BidFileBackup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BidFileBackup_backupKey_key" ON "BidFileBackup"("backupKey");
CREATE UNIQUE INDEX "BidFileBackup_supplierId_projectId_fileRole_key" ON "BidFileBackup"("supplierId", "projectId", "fileRole");
CREATE INDEX "BidFileBackup_projectId_supplierId_idx" ON "BidFileBackup"("projectId", "supplierId");
