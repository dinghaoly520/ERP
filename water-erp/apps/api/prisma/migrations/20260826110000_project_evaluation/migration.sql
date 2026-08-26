-- E1（GB/T 43711 第 9 章）：采购质效评价 + 供应商满意度
CREATE TABLE "ProjectEvaluation" (
    "id" TEXT NOT NULL,
    "projectManagementItemId" TEXT,
    "projectId" TEXT,
    "projectCode" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "evaluatorId" TEXT NOT NULL,
    "evaluatorName" TEXT NOT NULL,
    "qualityScore" INT NOT NULL,
    "efficiencyScore" INT NOT NULL,
    "complianceScore" INT NOT NULL,
    "weightedScore" INT NOT NULL,
    "period" TEXT,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectEvaluation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SatisfactionFeedback" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "score" INT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SatisfactionFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectEvaluation_projectCode_idx" ON "ProjectEvaluation"("projectCode");
CREATE INDEX "ProjectEvaluation_createdAt_idx" ON "ProjectEvaluation"("createdAt");
CREATE UNIQUE INDEX "SatisfactionFeedback_supplierId_projectCode_key" ON "SatisfactionFeedback"("supplierId", "projectCode");
CREATE INDEX "SatisfactionFeedback_projectCode_idx" ON "SatisfactionFeedback"("projectCode");
