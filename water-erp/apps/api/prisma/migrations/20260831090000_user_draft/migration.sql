-- 用户向导草稿（跨设备续作）：账号+草稿键 唯一，payload JSON
CREATE TABLE "UserDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDraft_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserDraft_userId_key_key" ON "UserDraft"("userId", "key");
ALTER TABLE "UserDraft" ADD CONSTRAINT "UserDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
