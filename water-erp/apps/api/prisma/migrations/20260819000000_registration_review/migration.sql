-- 注册审核历史表（append-only，不可删改）
CREATE TABLE "registration_reviews" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "department" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "officeLocation" TEXT,
    "requestedRole" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "decisionNote" TEXT,
    "reviewedById" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_reviews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "registration_reviews_decision_reviewedAt_idx" ON "registration_reviews"("decision", "reviewedAt");
CREATE INDEX "registration_reviews_username_reviewedAt_idx" ON "registration_reviews"("username", "reviewedAt");
