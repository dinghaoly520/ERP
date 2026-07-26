-- Step 2: Add grade columns, migrate data, drop old score columns

-- Add new grade columns (nullable first)
ALTER TABLE "ExpertEvaluation" ADD COLUMN "attendanceGrade" "ExpertLevel";
ALTER TABLE "ExpertEvaluation" ADD COLUMN "qualityGrade"    "ExpertLevel";
ALTER TABLE "ExpertEvaluation" ADD COLUMN "disciplineGrade" "ExpertLevel";
ALTER TABLE "ExpertEvaluation" ADD COLUMN "overallGrade"    "ExpertLevel";

-- Migrate old numeric scores to grade values
UPDATE "ExpertEvaluation" SET
  "attendanceGrade" = CASE
    WHEN "attendanceScore" >= 90 THEN 'A'::"ExpertLevel"
    WHEN "attendanceScore" >= 80 THEN 'B'::"ExpertLevel"
    WHEN "attendanceScore" >= 70 THEN 'C'::"ExpertLevel"
    WHEN "attendanceScore" >= 60 THEN 'D'::"ExpertLevel"
    ELSE 'E'::"ExpertLevel"
  END,
  "qualityGrade" = CASE
    WHEN "qualityScore" >= 90 THEN 'A'::"ExpertLevel"
    WHEN "qualityScore" >= 80 THEN 'B'::"ExpertLevel"
    WHEN "qualityScore" >= 70 THEN 'C'::"ExpertLevel"
    WHEN "qualityScore" >= 60 THEN 'D'::"ExpertLevel"
    ELSE 'E'::"ExpertLevel"
  END,
  "disciplineGrade" = CASE
    WHEN "disciplineScore" >= 90 THEN 'A'::"ExpertLevel"
    WHEN "disciplineScore" >= 80 THEN 'B'::"ExpertLevel"
    WHEN "disciplineScore" >= 70 THEN 'C'::"ExpertLevel"
    WHEN "disciplineScore" >= 60 THEN 'D'::"ExpertLevel"
    ELSE 'E'::"ExpertLevel"
  END,
  "overallGrade" = CASE
    WHEN "overallScore" >= 90 THEN 'A'::"ExpertLevel"
    WHEN "overallScore" >= 80 THEN 'B'::"ExpertLevel"
    WHEN "overallScore" >= 70 THEN 'C'::"ExpertLevel"
    WHEN "overallScore" >= 60 THEN 'D'::"ExpertLevel"
    ELSE 'E'::"ExpertLevel"
  END;

-- Set NOT NULL
ALTER TABLE "ExpertEvaluation" ALTER COLUMN "attendanceGrade" SET NOT NULL;
ALTER TABLE "ExpertEvaluation" ALTER COLUMN "qualityGrade"    SET NOT NULL;
ALTER TABLE "ExpertEvaluation" ALTER COLUMN "disciplineGrade" SET NOT NULL;
ALTER TABLE "ExpertEvaluation" ALTER COLUMN "overallGrade"    SET NOT NULL;

-- Drop old fields
ALTER TABLE "ExpertEvaluation" DROP COLUMN "attendanceScore";
ALTER TABLE "ExpertEvaluation" DROP COLUMN "qualityScore";
ALTER TABLE "ExpertEvaluation" DROP COLUMN "disciplineScore";
ALTER TABLE "ExpertEvaluation" DROP COLUMN "overallScore";
ALTER TABLE "ExpertEvaluation" DROP COLUMN "level";
