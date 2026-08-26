-- W8（CTS A-115/A-147）：开标记录/评标模板
CREATE TABLE "WorkTemplate" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkTemplate_kind_name_key" ON "WorkTemplate"("kind", "name");
CREATE INDEX "WorkTemplate_kind_idx" ON "WorkTemplate"("kind");
