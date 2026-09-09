-- CreateTable
CREATE TABLE "ProjectTenderDraft" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "drafts" JSONB NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectTenderDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTenderDraftVersion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "drafts" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectTenderDraftVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTenderDraft_projectId_key" ON "ProjectTenderDraft"("projectId");

-- CreateIndex
CREATE INDEX "ProjectTenderDraft_updatedAt_idx" ON "ProjectTenderDraft"("updatedAt");

-- CreateIndex
CREATE INDEX "ProjectTenderDraftVersion_projectId_createdAt_idx" ON "ProjectTenderDraftVersion"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProjectTenderDraft" ADD CONSTRAINT "ProjectTenderDraft_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectManagementItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTenderDraftVersion" ADD CONSTRAINT "ProjectTenderDraftVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ProjectManagementItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

