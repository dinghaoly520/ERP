-- CreateEnum
CREATE TYPE "SignStatus" AS ENUM ('PENDING', 'SIGNED', 'REFUSED_DISSENT', 'DEEMED_AGREED');

-- AlterTable
ALTER TABLE "BidExpert" ADD COLUMN     "signStatus" "SignStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "signStatusAt" TIMESTAMP(3),
ADD COLUMN     "signScanFileId" TEXT,
ADD COLUMN     "signRegisteredBy" TEXT;

-- CreateTable
CREATE TABLE "BidSignPacket" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fileAssetId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "generatedById" TEXT NOT NULL,
    "signPageScanFileId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "handoverFileAssetId" TEXT,
    "handoverSha256" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BidSignPacket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BidSignPacket_projectId_key" ON "BidSignPacket"("projectId");

-- AddForeignKey
ALTER TABLE "BidSignPacket" ADD CONSTRAINT "BidSignPacket_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
