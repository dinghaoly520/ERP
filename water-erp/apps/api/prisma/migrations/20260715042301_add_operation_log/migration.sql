-- CreateTable
CREATE TABLE "OperationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "username" TEXT,
    "role" TEXT,
    "portal" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "query" TEXT,
    "body" JSONB,
    "statusCode" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "referer" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperationLog_userId_createdAt_idx" ON "OperationLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "OperationLog_createdAt_idx" ON "OperationLog"("createdAt");

-- CreateIndex
CREATE INDEX "OperationLog_role_createdAt_idx" ON "OperationLog"("role", "createdAt");

-- CreateIndex
CREATE INDEX "OperationLog_portal_createdAt_idx" ON "OperationLog"("portal", "createdAt");

-- CreateIndex
CREATE INDEX "OperationLog_path_createdAt_idx" ON "OperationLog"("path", "createdAt");

-- CreateIndex
CREATE INDEX "OperationLog_statusCode_createdAt_idx" ON "OperationLog"("statusCode", "createdAt");
