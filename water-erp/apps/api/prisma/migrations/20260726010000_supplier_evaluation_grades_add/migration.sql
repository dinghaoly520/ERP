-- Step 1: Add grade columns (nullable first)
ALTER TABLE "SupplierEvaluation" ADD COLUMN "completenessGrade"  "ExpertLevel";
ALTER TABLE "SupplierEvaluation" ADD COLUMN "responsivenessGrade" "ExpertLevel";
ALTER TABLE "SupplierEvaluation" ADD COLUMN "cooperationGrade"    "ExpertLevel";
ALTER TABLE "SupplierEvaluation" ADD COLUMN "complianceGrade"     "ExpertLevel";
ALTER TABLE "SupplierEvaluation" ADD COLUMN "comprehensiveGrade"  "ExpertLevel";
ALTER TABLE "SupplierEvaluation" ADD COLUMN "finalGrade"          "ExpertLevel";

-- Step 2: Migrate old scores to grades
-- completeness max=20, responsiveness max=30, cooperation max=20, compliance max=20, comprehensive max=10
-- use percentage: >=90%→A, >=80%→B, >=70%→C, >=60%→D, <60%→E

UPDATE "SupplierEvaluation" SET
  "completenessGrade" = CASE
    WHEN "completenessScore" >= 18 THEN 'A'::"ExpertLevel"
    WHEN "completenessScore" >= 16 THEN 'B'::"ExpertLevel"
    WHEN "completenessScore" >= 14 THEN 'C'::"ExpertLevel"
    WHEN "completenessScore" >= 12 THEN 'D'::"ExpertLevel"
    ELSE 'E'::"ExpertLevel"
  END,
  "responsivenessGrade" = CASE
    WHEN "responsivenessScore" >= 27 THEN 'A'::"ExpertLevel"
    WHEN "responsivenessScore" >= 24 THEN 'B'::"ExpertLevel"
    WHEN "responsivenessScore" >= 21 THEN 'C'::"ExpertLevel"
    WHEN "responsivenessScore" >= 18 THEN 'D'::"ExpertLevel"
    ELSE 'E'::"ExpertLevel"
  END,
  "cooperationGrade" = CASE
    WHEN "cooperationScore" >= 18 THEN 'A'::"ExpertLevel"
    WHEN "cooperationScore" >= 16 THEN 'B'::"ExpertLevel"
    WHEN "cooperationScore" >= 14 THEN 'C'::"ExpertLevel"
    WHEN "cooperationScore" >= 12 THEN 'D'::"ExpertLevel"
    ELSE 'E'::"ExpertLevel"
  END,
  "complianceGrade" = CASE
    WHEN "complianceScore" >= 18 THEN 'A'::"ExpertLevel"
    WHEN "complianceScore" >= 16 THEN 'B'::"ExpertLevel"
    WHEN "complianceScore" >= 14 THEN 'C'::"ExpertLevel"
    WHEN "complianceScore" >= 12 THEN 'D'::"ExpertLevel"
    ELSE 'E'::"ExpertLevel"
  END,
  "comprehensiveGrade" = CASE
    WHEN "overallScore" >= 9 THEN 'A'::"ExpertLevel"
    WHEN "overallScore" >= 8 THEN 'B'::"ExpertLevel"
    WHEN "overallScore" >= 7 THEN 'C'::"ExpertLevel"
    WHEN "overallScore" >= 6 THEN 'D'::"ExpertLevel"
    ELSE 'E'::"ExpertLevel"
  END,
  "finalGrade" = CASE
    WHEN "score" >= 90 THEN 'A'::"ExpertLevel"
    WHEN "score" >= 80 THEN 'B'::"ExpertLevel"
    WHEN "score" >= 70 THEN 'C'::"ExpertLevel"
    WHEN "score" >= 60 THEN 'D'::"ExpertLevel"
    ELSE 'E'::"ExpertLevel"
  END;

-- Step 3: Set NOT NULL
ALTER TABLE "SupplierEvaluation" ALTER COLUMN "completenessGrade"  SET NOT NULL;
ALTER TABLE "SupplierEvaluation" ALTER COLUMN "responsivenessGrade" SET NOT NULL;
ALTER TABLE "SupplierEvaluation" ALTER COLUMN "cooperationGrade"    SET NOT NULL;
ALTER TABLE "SupplierEvaluation" ALTER COLUMN "complianceGrade"     SET NOT NULL;
ALTER TABLE "SupplierEvaluation" ALTER COLUMN "comprehensiveGrade"  SET NOT NULL;
ALTER TABLE "SupplierEvaluation" ALTER COLUMN "finalGrade"          SET NOT NULL;

-- Step 4: Drop old columns
ALTER TABLE "SupplierEvaluation" DROP COLUMN "score";
ALTER TABLE "SupplierEvaluation" DROP COLUMN "level";
ALTER TABLE "SupplierEvaluation" DROP COLUMN "completenessScore";
ALTER TABLE "SupplierEvaluation" DROP COLUMN "responsivenessScore";
ALTER TABLE "SupplierEvaluation" DROP COLUMN "cooperationScore";
ALTER TABLE "SupplierEvaluation" DROP COLUMN "complianceScore";
ALTER TABLE "SupplierEvaluation" DROP COLUMN "overallScore";
