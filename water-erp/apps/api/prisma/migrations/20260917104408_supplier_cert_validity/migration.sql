-- SupplierCert 证书有效期（A-13）：mock 证书生成即带 60 天有效期（D1v2），真 CA 证书必带。
-- null=未携带/长期（存量介质与旧中间件实例生成的证书）；expiryNotifyStage 为 A-13 到期提醒幂等档位。

-- AlterTable
ALTER TABLE "SupplierCert" ADD COLUMN     "notBefore"         TIMESTAMP(3);
ALTER TABLE "SupplierCert" ADD COLUMN     "expiresAt"         TIMESTAMP(3);
ALTER TABLE "SupplierCert" ADD COLUMN     "expiryNotifyStage" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "SupplierCert_bindingStatus_expiresAt_idx" ON "SupplierCert"("bindingStatus", "expiresAt");
