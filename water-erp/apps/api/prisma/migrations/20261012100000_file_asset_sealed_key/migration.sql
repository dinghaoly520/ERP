-- 通用上传服务端密封（2026-10-12 密文评估 P1-1）：
-- qualification/profile/general/contract_document/framework_document/performance_report
-- 类目上传时 DEK 经 KMS_SECRET 包裹后落此列；密文存 MinIO（asset.key），下载流式解密。
ALTER TABLE "FileAsset" ADD COLUMN "sealedKey" TEXT;
