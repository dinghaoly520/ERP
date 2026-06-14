-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "metadata" JSONB;

-- CreateTable
CREATE TABLE "AnnouncementAttachment" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "fileAssetId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidDocument" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "fileAssetId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "accessScope" TEXT NOT NULL DEFAULT 'OPEN',
    "requirePayment" BOOLEAN NOT NULL DEFAULT false,
    "price" DECIMAL(12,2),
    "decryptKey" TEXT NOT NULL,
    "bidProjectId" TEXT,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BidDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BidDocumentAccess" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "eligible" BOOLEAN NOT NULL DEFAULT true,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "paymentRef" TEXT,
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "lastDownloadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BidDocumentAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnnouncementAttachment_announcementId_idx" ON "AnnouncementAttachment"("announcementId");

-- CreateIndex
CREATE UNIQUE INDEX "BidDocument_announcementId_key" ON "BidDocument"("announcementId");

-- CreateIndex
CREATE INDEX "BidDocument_accessScope_idx" ON "BidDocument"("accessScope");

-- CreateIndex
CREATE INDEX "BidDocumentAccess_supplierId_idx" ON "BidDocumentAccess"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "BidDocumentAccess_documentId_supplierId_key" ON "BidDocumentAccess"("documentId", "supplierId");

-- AddForeignKey
ALTER TABLE "AnnouncementAttachment" ADD CONSTRAINT "AnnouncementAttachment_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementAttachment" ADD CONSTRAINT "AnnouncementAttachment_fileAssetId_fkey" FOREIGN KEY ("fileAssetId") REFERENCES "FileAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidDocument" ADD CONSTRAINT "BidDocument_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidDocument" ADD CONSTRAINT "BidDocument_fileAssetId_fkey" FOREIGN KEY ("fileAssetId") REFERENCES "FileAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidDocumentAccess" ADD CONSTRAINT "BidDocumentAccess_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "BidDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BidDocumentAccess" ADD CONSTRAINT "BidDocumentAccess_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
