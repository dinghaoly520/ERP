-- W1 招标文件澄清与修改（CTS-EBS01 A-80~A-86）
-- CreateTable
CREATE TABLE "TenderClarification" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "attachmentId" TEXT,
    "status" TEXT NOT NULL DEFAULT '待答复',
    "answer" TEXT,
    "answeredBy" TEXT,
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenderClarification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderClarificationDoc" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "fileAssetId" TEXT,
    "status" TEXT NOT NULL DEFAULT '草稿',
    "publishedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenderClarificationDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenderClarificationReceipt" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "downloadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receiptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenderClarificationReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenderClarification_projectId_idx" ON "TenderClarification"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "TenderClarificationDoc_projectId_version_key" ON "TenderClarificationDoc"("projectId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "TenderClarificationReceipt_docId_supplierId_key" ON "TenderClarificationReceipt"("docId", "supplierId");

-- AddForeignKey（Prisma 迁移惯例：CASCADE/SET NULL）
ALTER TABLE "TenderClarification" ADD CONSTRAINT "TenderClarification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenderClarification" ADD CONSTRAINT "TenderClarification_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TenderClarificationDoc" ADD CONSTRAINT "TenderClarificationDoc_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenderClarificationReceipt" ADD CONSTRAINT "TenderClarificationReceipt_docId_fkey" FOREIGN KEY ("docId") REFERENCES "TenderClarificationDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenderClarificationReceipt" ADD CONSTRAINT "TenderClarificationReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterEnum（PG 不能在事务内 ADD VALUE——db execute 每句自动提交，安全）
ALTER TYPE "AnnouncementType" ADD VALUE 'CLARIFY_NOTICE';
