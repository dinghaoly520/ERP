-- Step 1: Add userId column as nullable first
ALTER TABLE "BidExpert" ADD COLUMN "userId" TEXT;

-- Step 2: Fill userId from User table by matching expertName -> displayName
UPDATE "BidExpert" e
SET "userId" = u.id
FROM "User" u
WHERE u."displayName" = e."expertName";

-- Step 3: Make userId NOT NULL (all existing rows should now have a value)
ALTER TABLE "BidExpert" ALTER COLUMN "userId" SET NOT NULL;

-- Step 4: Make BidScoreRecord.supplierId NOT NULL
-- First, fill any NULL supplierId with an empty string placeholder (shouldn't exist in seed data)
-- UPDATE "BidScoreRecord" SET "supplierId" = '' WHERE "supplierId" IS NULL;
-- Actually, since we just reset the DB, there should be no BidScoreRecord rows.
-- If there are records with NULL, the NOT NULL constraint will fail.
ALTER TABLE "BidScoreRecord" ALTER COLUMN "supplierId" SET NOT NULL;

-- Step 5: Create indexes
CREATE INDEX "BidExpert_userId_idx" ON "BidExpert"("userId");
CREATE UNIQUE INDEX "BidExpert_projectId_userId_key" ON "BidExpert"("projectId", "userId");
CREATE UNIQUE INDEX "BidScoreRecord_expertId_scoreItemId_supplierId_key" ON "BidScoreRecord"("expertId", "scoreItemId", "supplierId");

-- Step 6: Add foreign key
ALTER TABLE "BidExpert" ADD CONSTRAINT "BidExpert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
