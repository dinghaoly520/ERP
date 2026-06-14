-- CreateEnum
CREATE TYPE "ExpertLevel" AS ENUM ('A', 'B', 'C', 'D');

-- CreateTable
CREATE TABLE "ExpertProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "specialty" TEXT NOT NULL,
    "title" TEXT,
    "employer" TEXT,
    "phone" TEXT,
    "idNumber" TEXT,
    "availability" TEXT NOT NULL DEFAULT '可用',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpertProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpertEvaluation" (
    "id" TEXT NOT NULL,
    "expertUserId" TEXT NOT NULL,
    "projectId" TEXT,
    "evaluatorId" TEXT NOT NULL,
    "attendanceScore" INTEGER NOT NULL,
    "qualityScore" INTEGER NOT NULL,
    "disciplineScore" INTEGER NOT NULL,
    "overallScore" INTEGER NOT NULL,
    "level" "ExpertLevel" NOT NULL DEFAULT 'B',
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpertEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpertProfile_userId_key" ON "ExpertProfile"("userId");

-- CreateIndex
CREATE INDEX "ExpertProfile_specialty_idx" ON "ExpertProfile"("specialty");

-- CreateIndex
CREATE INDEX "ExpertProfile_availability_idx" ON "ExpertProfile"("availability");

-- CreateIndex
CREATE INDEX "ExpertEvaluation_expertUserId_idx" ON "ExpertEvaluation"("expertUserId");

-- CreateIndex
CREATE INDEX "ExpertEvaluation_evaluatorId_idx" ON "ExpertEvaluation"("evaluatorId");

-- AddForeignKey
ALTER TABLE "ExpertProfile" ADD CONSTRAINT "ExpertProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpertEvaluation" ADD CONSTRAINT "ExpertEvaluation_expertUserId_fkey" FOREIGN KEY ("expertUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpertEvaluation" ADD CONSTRAINT "ExpertEvaluation_evaluatorId_fkey" FOREIGN KEY ("evaluatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill ExpertProfile for existing bid_expert users (specialty from latest assignment major)
INSERT INTO "ExpertProfile" ("id", "userId", "specialty", "availability", "createdAt", "updatedAt")
SELECT
  replace(gen_random_uuid()::text, '-', ''),
  u."id",
  COALESCE((
    SELECT be."major" FROM "BidExpert" be
    WHERE be."userId" = u."id" AND be."major" IS NOT NULL AND be."major" <> ''
    ORDER BY be."createdAt" DESC LIMIT 1
  ), '综合'),
  '可用',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u
WHERE u."role" = 'bid_expert'
  AND NOT EXISTS (SELECT 1 FROM "ExpertProfile" ep WHERE ep."userId" = u."id");
