-- AlterTable
ALTER TABLE "ReviewTask" ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "draftFingerprint" TEXT;

-- CreateIndex
CREATE INDEX "ReviewTask_projectId_idx" ON "ReviewTask"("projectId");

-- AlterTable
ALTER TABLE "UserSettings" ADD COLUMN     "defaultReviewKbId" TEXT;
