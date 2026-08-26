-- CTS-EBS01 A-47~49 任务计划与项目团队（定点迁移：存量漂移不走 migrate dev）

CREATE TABLE "ProjectPlanItem" (
  "id" TEXT NOT NULL,
  "projectManagementItemId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "ownerUserId" TEXT,
  "startDate" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "submittedAt" TIMESTAMP(3),
  "submittedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "reviewComment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectPlanItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProjectPlanItem_projectManagementItemId_idx" ON "ProjectPlanItem"("projectManagementItemId");
ALTER TABLE "ProjectPlanItem" ADD CONSTRAINT "ProjectPlanItem_projectManagementItemId_fkey" FOREIGN KEY ("projectManagementItemId") REFERENCES "ProjectManagementItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProjectTeamMember" (
  "id" TEXT NOT NULL,
  "projectManagementItemId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "duty" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectTeamMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectTeamMember_projectManagementItemId_userId_key" ON "ProjectTeamMember"("projectManagementItemId", "userId");
CREATE INDEX "ProjectTeamMember_projectManagementItemId_idx" ON "ProjectTeamMember"("projectManagementItemId");
ALTER TABLE "ProjectTeamMember" ADD CONSTRAINT "ProjectTeamMember_projectManagementItemId_fkey" FOREIGN KEY ("projectManagementItemId") REFERENCES "ProjectManagementItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectTeamMember" ADD CONSTRAINT "ProjectTeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
