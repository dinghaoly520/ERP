-- AlterTable
ALTER TABLE "BidSupplier" ADD COLUMN     "dangerAttribution" TEXT;

-- AlterTable
ALTER TABLE "SupplierBidSubmission" ADD COLUMN     "decryptedAssets" JSONB,
ADD COLUMN     "decryptedPrice" TEXT,
ADD COLUMN     "envelope" JSONB,
ADD COLUMN     "envelopeVersion" TEXT,
ADD COLUMN     "innerAssets" JSONB,
ADD COLUMN     "outerDecryptedAt" TIMESTAMP(3),
ADD COLUMN     "packageFetchedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SupplierCert" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "certSn" TEXT NOT NULL,
    "certDn" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "alg" TEXT NOT NULL DEFAULT 'SM2',
    "bindingStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
    "boundAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "SupplierCert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminEncryptionCert" (
    "id" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "certDn" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminEncryptionCert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplierCert_certSn_key" ON "SupplierCert"("certSn");

-- CreateIndex
CREATE INDEX "SupplierCert_supplierId_idx" ON "SupplierCert"("supplierId");

-- AddForeignKey
ALTER TABLE "SupplierCert" ADD CONSTRAINT "SupplierCert_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
