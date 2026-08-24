-- 资料变更申请（2026-08-24）：个人中心所有资料修改一律走审批
-- 定点迁移：prisma db execute --url $DIRECT_URL --file 本文件 → migrate resolve --applied

CREATE TABLE "ProfileChangeRequest" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "payload"      JSONB NOT NULL,
    "status"       "PasswordChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decisionNote" TEXT,
    "requestedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt"   TIMESTAMP(3),
    "reviewedById" TEXT,

    CONSTRAINT "ProfileChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProfileChangeRequest_userId_status_idx" ON "ProfileChangeRequest" ("userId", "status");
CREATE INDEX "ProfileChangeRequest_status_requestedAt_idx" ON "ProfileChangeRequest" ("status", "requestedAt");

ALTER TABLE "ProfileChangeRequest" ADD CONSTRAINT "ProfileChangeRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfileChangeRequest" ADD CONSTRAINT "ProfileChangeRequest_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
