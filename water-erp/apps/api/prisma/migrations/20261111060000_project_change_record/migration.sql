CREATE TABLE "ProjectChangeRecord" (
    "id" TEXT NOT NULL,
    "projectManagementItemId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "changeset" JSONB NOT NULL,
    "needsAnnouncement" BOOLEAN NOT NULL DEFAULT false,
    "announcementId" TEXT,
    "operatorId" TEXT NOT NULL,
    "operatorName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectChangeRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectChangeRecord_projectManagementItemId_round_idx" ON "ProjectChangeRecord"("projectManagementItemId", "round");
ALTER TYPE "AnnouncementType" ADD VALUE IF NOT EXISTS 'CHANGE_NOTICE';
