-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "resolvedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Notification_userId_type_resolvedAt_idx" ON "Notification"("userId", "type", "resolvedAt");
