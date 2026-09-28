-- 阶段1 X.509 真证书绑定轨：SupplierCert 落库增量列（供应商 CA 证书 DER 唯一事实源）
-- AlterTable
ALTER TABLE "SupplierCert" ADD COLUMN     "rawCert"   TEXT,
ADD COLUMN     "issuerDn"  TEXT,
ADD COLUMN     "certSource" TEXT NOT NULL DEFAULT 'mock';
