-- AlterTable
ALTER TABLE "BidEvaluationResult" ADD COLUMN     "disqualified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "BidScoreRecord" ADD COLUMN     "passed" BOOLEAN;
