-- CreateTable
CREATE TABLE "WorkArrangementDailyPlanCache" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "plan" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkArrangementDailyPlanCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkArrangementDailyPlanCache_userId_date_idx" ON "WorkArrangementDailyPlanCache"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "WorkArrangementDailyPlanCache_userId_date_key" ON "WorkArrangementDailyPlanCache"("userId", "date");
