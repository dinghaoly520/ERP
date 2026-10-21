-- 专家邀请回执留痕（2026-10-21 代为变更设计适配专家域，口径与供应商 InvitationRsvp 对齐）：
-- 1) BidExpert 增作答方三列（invitationActorType/invitationActorName/invitationReason）
--    + 专家自答快照两列（expertRespondedAt/expertStatus，代变更不覆盖）
-- 2) 新表 ExpertInvitationLog：邀请状态/角色流转全量落账（自答/超时弃权/代变更/递补/替换）
ALTER TABLE "BidExpert" ADD COLUMN "invitationActorType" TEXT;
ALTER TABLE "BidExpert" ADD COLUMN "invitationActorName" TEXT;
ALTER TABLE "BidExpert" ADD COLUMN "invitationReason" TEXT;
ALTER TABLE "BidExpert" ADD COLUMN "expertRespondedAt" TIMESTAMP(3);
ALTER TABLE "BidExpert" ADD COLUMN "expertStatus" TEXT;

CREATE TABLE "ExpertInvitationLog" (
    "id" TEXT NOT NULL,
    "bidExpertId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "fromRole" TEXT,
    "toRole" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpertInvitationLog_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ExpertInvitationLog" ADD CONSTRAINT "ExpertInvitationLog_bidExpertId_fkey" FOREIGN KEY ("bidExpertId") REFERENCES "BidExpert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ExpertInvitationLog_projectId_idx" ON "ExpertInvitationLog"("projectId");
CREATE INDEX "ExpertInvitationLog_userId_idx" ON "ExpertInvitationLog"("userId");
CREATE INDEX "ExpertInvitationLog_bidExpertId_idx" ON "ExpertInvitationLog"("bidExpertId");
