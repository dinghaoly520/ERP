CREATE TABLE "BidMotion" (
    "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "type" TEXT NOT NULL,
    "title" TEXT NOT NULL, "description" TEXT, "status" TEXT NOT NULL DEFAULT 'open',
    "result" TEXT, "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "closedAt" TIMESTAMP(3),
    CONSTRAINT "BidMotion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BidMotion_projectId_idx" ON "BidMotion"("projectId");
ALTER TABLE "BidMotion" ADD CONSTRAINT "BidMotion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE;

CREATE TABLE "BidVote" (
    "id" TEXT NOT NULL, "motionId" TEXT NOT NULL, "expertId" TEXT NOT NULL,
    "vote" TEXT NOT NULL, "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BidVote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BidVote_motionId_expertId_key" ON "BidVote"("motionId", "expertId");
ALTER TABLE "BidVote" ADD CONSTRAINT "BidVote_motionId_fkey" FOREIGN KEY ("motionId") REFERENCES "BidMotion"("id") ON DELETE CASCADE;
