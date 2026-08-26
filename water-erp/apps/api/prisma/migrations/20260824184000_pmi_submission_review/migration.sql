-- CTS-EBS01 A-36/37 项目递交与受理留痕（定点迁移：存量漂移不走 migrate dev）
-- ProjectManagementItem 增加递交/审核状态与双人留痕（申报人/时间、验证人/时间）

ALTER TABLE "ProjectManagementItem" ADD COLUMN "reviewStatus" TEXT;
ALTER TABLE "ProjectManagementItem" ADD COLUMN "submittedAt" TIMESTAMP(3);
ALTER TABLE "ProjectManagementItem" ADD COLUMN "submittedById" TEXT;
ALTER TABLE "ProjectManagementItem" ADD COLUMN "reviewedAt" TIMESTAMP(3);
ALTER TABLE "ProjectManagementItem" ADD COLUMN "reviewedById" TEXT;
ALTER TABLE "ProjectManagementItem" ADD COLUMN "reviewComment" TEXT;

ALTER TABLE "ProjectManagementItem" ADD CONSTRAINT "ProjectManagementItem_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectManagementItem" ADD CONSTRAINT "ProjectManagementItem_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMENT ON COLUMN "ProjectManagementItem"."reviewStatus" IS 'CTS A-36/37: null=未递交 | PENDING | APPROVED | REJECTED';
