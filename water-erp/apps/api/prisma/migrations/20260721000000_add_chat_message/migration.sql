-- 即时聊天：一对一私信表
-- type: text | image | file
-- content: text 时为正文; image/file 时为文件名
-- fileUrl/fileMime/fileSize 缓存 /api/upload/files/:id 的元数据, 避免前端再查
-- 离线消息直接落库, 上线后 GET /chat/conversations 拉未读

CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "content" TEXT NOT NULL,
    "fileAssetId" TEXT,
    "fileUrl" TEXT,
    "fileMime" TEXT,
    "fileSize" INTEGER,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- 外键
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_senderId_fkey"
    FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_receiverId_fkey"
    FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_fileAssetId_fkey"
    FOREIGN KEY ("fileAssetId") REFERENCES "FileAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 索引：按会话拉历史 + 拉未读
CREATE INDEX "ChatMessage_senderId_receiverId_createdAt_idx"
    ON "ChatMessage"("senderId", "receiverId", "createdAt");
CREATE INDEX "ChatMessage_receiverId_readAt_idx"
    ON "ChatMessage"("receiverId", "readAt");
