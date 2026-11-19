
-- CreateTable
CREATE TABLE "assistant_feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "guestKey" TEXT,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_feedback_messageId_idx" ON "assistant_feedback"("messageId");

-- CreateIndex
CREATE INDEX "assistant_feedback_userId_createdAt_idx" ON "assistant_feedback"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "assistant_feedback_guestKey_createdAt_idx" ON "assistant_feedback"("guestKey", "createdAt");
