-- 内容指纹（2026-11-24 全项目同文件查重）：新上传写列，存量懒回填
ALTER TABLE "Attachment" ADD COLUMN "sha256" TEXT;
