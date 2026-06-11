-- CreateEnum
CREATE TYPE "AnnouncementType" AS ENUM ('BID_NOTICE', 'WIN_NOTICE', 'POLICY', 'PLATFORM');

-- CreateEnum
CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" "AnnouncementType" NOT NULL DEFAULT 'BID_NOTICE',
    "status" "AnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
    "summary" TEXT,
    "publishDate" TIMESTAMP(3),
    "isTop" BOOLEAN NOT NULL DEFAULT false,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "relatedProjectCode" TEXT,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierBidSubmission" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "bidPrice" TEXT,
    "deliveryPeriod" TEXT,
    "technicalFile" TEXT,
    "businessFile" TEXT,
    "coverLetter" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierBidSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Announcement_type_idx" ON "Announcement"("type");

-- CreateIndex
CREATE INDEX "Announcement_status_idx" ON "Announcement"("status");

-- CreateIndex
CREATE INDEX "Announcement_publishDate_idx" ON "Announcement"("publishDate");

-- CreateIndex
CREATE INDEX "SupplierBidSubmission_supplierId_idx" ON "SupplierBidSubmission"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierBidSubmission_projectId_idx" ON "SupplierBidSubmission"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierBidSubmission_supplierId_projectId_key" ON "SupplierBidSubmission"("supplierId", "projectId");
