-- SCCA 阶段2 dual-v3（2026-10-14）
-- 只加不改——SupplierBidSubmission.revision 默认 0（旧轨行无版本管理）

ALTER TABLE "SupplierBidSubmission" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "SubmissionVersion" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "envelope" JSONB NOT NULL,
    "envelopeHash" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operationId" TEXT,
    CONSTRAINT "SubmissionVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SubmissionVersion_submissionId_revision_key" ON "SubmissionVersion"("submissionId", "revision");
CREATE INDEX "SubmissionVersion_submissionId_revision_submittedAt_idx" ON "SubmissionVersion"("submissionId", "revision", "submittedAt");
ALTER TABLE "SubmissionVersion" ADD CONSTRAINT "SubmissionVersion_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "SupplierBidSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DecryptExecution" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "fence" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    CONSTRAINT "DecryptExecution_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DecryptExecution_submissionId_revision_phase_key" ON "DecryptExecution"("submissionId", "revision", "phase");

CREATE TABLE "Outbox" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Outbox_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Outbox_status_topic_idx" ON "Outbox"("status", "topic");
