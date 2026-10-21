-- 采购邀请回执：一次性锁定 + 代回应留痕（2026-10-21）
-- 1) InvitationRsvp 增作答方四列：respondentType/respondedById/respondedByName/staffReason
-- 2) 新表 InvitationRsvpLog：回执轨迹（通知/自答/代变更/超时弃权全量落账）
ALTER TABLE "InvitationRsvp" ADD COLUMN "respondentType" TEXT;
ALTER TABLE "InvitationRsvp" ADD COLUMN "respondedById" TEXT;
ALTER TABLE "InvitationRsvp" ADD COLUMN "respondedByName" TEXT;
ALTER TABLE "InvitationRsvp" ADD COLUMN "staffReason" TEXT;

CREATE TABLE "InvitationRsvpLog" (
    "id" TEXT NOT NULL,
    "rsvpId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "projectId" TEXT,
    "action" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "reason" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvitationRsvpLog_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "InvitationRsvpLog" ADD CONSTRAINT "InvitationRsvpLog_rsvpId_fkey" FOREIGN KEY ("rsvpId") REFERENCES "InvitationRsvp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "InvitationRsvpLog_supplierId_idx" ON "InvitationRsvpLog"("supplierId");
CREATE INDEX "InvitationRsvpLog_projectId_idx" ON "InvitationRsvpLog"("projectId");
CREATE INDEX "InvitationRsvpLog_rsvpId_idx" ON "InvitationRsvpLog"("rsvpId");
