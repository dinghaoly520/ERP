CREATE TABLE "ExpertDispute" (
    "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "expertId" TEXT NOT NULL,
    "expertName" TEXT NOT NULL, "type" TEXT NOT NULL DEFAULT 'scoring',
    "title" TEXT NOT NULL, "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedBy" TEXT, "resolvedAt" TIMESTAMP(3), "response" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExpertDispute_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ExpertDispute_projectId_idx" ON "ExpertDispute"("projectId");
ALTER TABLE "ExpertDispute" ADD CONSTRAINT "ExpertDispute_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "BidProject"("id") ON DELETE CASCADE;
