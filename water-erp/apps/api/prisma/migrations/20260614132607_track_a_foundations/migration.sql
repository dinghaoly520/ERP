-- AlterTable
ALTER TABLE "BidProject" ADD COLUMN     "encryptionKeyId" TEXT;

-- AlterTable
ALTER TABLE "ExpertProfile" ADD COLUMN     "retireReason" TEXT,
ADD COLUMN     "retiredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "FileAsset" ADD COLUMN     "authTag" TEXT,
ADD COLUMN     "encrypted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "encryptionKeyId" TEXT,
ADD COLUMN     "iv" TEXT;

-- CreateTable
CREATE TABLE "NotificationDeliveryLog" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDeliveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationDeliveryLog_userId_idx" ON "NotificationDeliveryLog"("userId");

-- CreateIndex
CREATE INDEX "NotificationDeliveryLog_userId_channel_createdAt_idx" ON "NotificationDeliveryLog"("userId", "channel", "createdAt");
