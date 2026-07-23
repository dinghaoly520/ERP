-- CreateEnum
CREATE TYPE "OpeningHallRoomType" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "OpeningHallSenderRole" AS ENUM ('HOST', 'SUPPLIER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "OpeningHallMessageType" AS ENUM ('TEXT');

-- AlterTable
ALTER TABLE "BidSupplier" ADD COLUMN     "checkInAt" TIMESTAMP(3),
ADD COLUMN     "checkInMeta" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "BidOpeningSession" ADD COLUMN     "exchangeControl" TEXT NOT NULL DEFAULT 'OPEN';

-- AlterTable
ALTER TABLE "BidClarification" ADD COLUMN     "fileAssetId" TEXT;

-- CreateTable
CREATE TABLE "OpeningHallMessage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "roomType" "OpeningHallRoomType" NOT NULL,
    "supplierId" TEXT,
    "senderId" TEXT NOT NULL,
    "senderRole" "OpeningHallSenderRole" NOT NULL,
    "senderName" TEXT NOT NULL,
    "type" "OpeningHallMessageType" NOT NULL DEFAULT 'TEXT',
    "content" TEXT NOT NULL,
    "fileAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpeningHallMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningHallReadCursor" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roomKey" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpeningHallReadCursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OpeningHallMessage_projectId_roomType_supplierId_createdAt_idx" ON "OpeningHallMessage"("projectId", "roomType", "supplierId", "createdAt");

-- CreateIndex
CREATE INDEX "OpeningHallMessage_projectId_createdAt_idx" ON "OpeningHallMessage"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OpeningHallReadCursor_projectId_userId_roomKey_key" ON "OpeningHallReadCursor"("projectId", "userId", "roomKey");
