-- SCCA CA 证书体系增量迁移（只加不改——阶段1 Task1）
-- 设计: docs/superpowers/plans/2026-10-13-scca-phase1-binding-login-pilot.md

-- CreateTable: CA 证书不可变事实源
CREATE TABLE "CaCertificate" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'scca',
    "derBase64" TEXT NOT NULL,
    "sha256Fingerprint" TEXT NOT NULL,
    "serialHex" TEXT NOT NULL,
    "issuerNameDerHash" TEXT NOT NULL,
    "issuerDisplay" TEXT NOT NULL,
    "subjectDisplay" TEXT NOT NULL,
    "spkiAlgorithmOid" TEXT NOT NULL,
    "curveOid" TEXT,
    "keyUsage" TEXT[],
    "extendedKeyUsage" TEXT[],
    "unknownExtensionOids" TEXT[],
    "notBefore" TIMESTAMP(3) NOT NULL,
    "notAfter" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CaCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable: 签名证书全局占用
CREATE TABLE "CaSigningCertificateClaim" (
    "id" TEXT NOT NULL,
    "certificateId" TEXT NOT NULL,
    "supplierId" TEXT,
    "expertUserId" TEXT,
    "supplierBindingId" TEXT,
    "expertBindingId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releaseAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CaSigningCertificateClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CA 操作状态机
CREATE TABLE "CaOperation" (
    "id" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT,
    "purpose" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "businessRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "result" JSONB,
    "challengeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CaOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable: 验签证据记录
CREATE TABLE "CaVerificationRecord" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'scca',
    "protocolVersion" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "actorUserId" TEXT,
    "subjectId" TEXT,
    "bindingId" TEXT,
    "certFingerprint" TEXT NOT NULL,
    "operationDigest" TEXT,
    "toSignSha256" TEXT NOT NULL,
    "p7Sha256" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "statusCoverage" TEXT[],
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "evidenceAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CaVerificationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable: 双证到期提醒
CREATE TABLE "CaExpiryReminder" (
    "id" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "certificateId" TEXT NOT NULL,
    "usage" TEXT NOT NULL,
    "stage" INTEGER NOT NULL DEFAULT 0,
    "notifiedAt" TIMESTAMP(3),
    CONSTRAINT "CaExpiryReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: CaCertificate 唯一约束与索引
CREATE UNIQUE INDEX "CaCertificate_sha256Fingerprint_key" ON "CaCertificate"("sha256Fingerprint");
CREATE UNIQUE INDEX "CaCertificate_issuerNameDerHash_serialHex_key" ON "CaCertificate"("issuerNameDerHash", "serialHex");
CREATE INDEX "CaCertificate_notAfter_idx" ON "CaCertificate"("notAfter");

-- CreateIndex: CaSigningCertificateClaim
CREATE UNIQUE INDEX "CaSigningCertificateClaim_certificateId_key" ON "CaSigningCertificateClaim"("certificateId");
CREATE INDEX "CaSigningCertificateClaim_supplierId_idx" ON "CaSigningCertificateClaim"("supplierId");
CREATE INDEX "CaSigningCertificateClaim_expertUserId_idx" ON "CaSigningCertificateClaim"("expertUserId");
ALTER TABLE "CaSigningCertificateClaim" ADD CONSTRAINT "CaSigningCertificateClaim_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "CaCertificate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex: CaOperation
CREATE INDEX "CaOperation_subjectType_subjectId_status_idx" ON "CaOperation"("subjectType", "subjectId", "status");

-- CreateIndex: CaVerificationRecord
CREATE UNIQUE INDEX "CaVerificationRecord_requestId_key" ON "CaVerificationRecord"("requestId");

-- CreateIndex: CaExpiryReminder
CREATE UNIQUE INDEX "CaExpiryReminder_bindingId_certificateId_usage_stage_key" ON "CaExpiryReminder"("bindingId", "certificateId", "usage", "stage");

-- AddColumn: SupplierCert 新列（SCCA CA 轨）
ALTER TABLE "SupplierCert" ADD COLUMN "credentialScheme" TEXT NOT NULL DEFAULT 'legacy-raw-sm2';
ALTER TABLE "SupplierCert" ADD COLUMN "signingCaCertificateId" TEXT;
ALTER TABLE "SupplierCert" ADD COLUMN "encryptionCaCertificateId" TEXT;
ALTER TABLE "SupplierCert" ADD COLUMN "bindingRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SupplierCert" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "SupplierCert" ADD COLUMN "revocationReason" TEXT;

-- AddColumn: ExpertCert 新列
ALTER TABLE "ExpertCert" ADD COLUMN "credentialScheme" TEXT NOT NULL DEFAULT 'legacy-raw-sm2';
ALTER TABLE "ExpertCert" ADD COLUMN "signingCaCertificateId" TEXT;
ALTER TABLE "ExpertCert" ADD COLUMN "bindingRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ExpertCert" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "ExpertCert" ADD COLUMN "revocationReason" TEXT;

-- AddColumn: Supplier.caCredentialRevision
ALTER TABLE "Supplier" ADD COLUMN "caCredentialRevision" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey: SupplierCert → CaCertificate 双向
ALTER TABLE "SupplierCert" ADD CONSTRAINT "SupplierCert_signingCaCertificateId_fkey" FOREIGN KEY ("signingCaCertificateId") REFERENCES "CaCertificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierCert" ADD CONSTRAINT "SupplierCert_encryptionCaCertificateId_fkey" FOREIGN KEY ("encryptionCaCertificateId") REFERENCES "CaCertificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExpertCert" ADD CONSTRAINT "ExpertCert_signingCaCertificateId_fkey" FOREIGN KEY ("signingCaCertificateId") REFERENCES "CaCertificate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- PartialUniqueIndex: 每主体至多一条 ACTIVE 绑定
CREATE UNIQUE INDEX "supplier_cert_one_active" ON "SupplierCert"("supplierId") WHERE "bindingStatus" = 'ACTIVE';
CREATE UNIQUE INDEX "expert_cert_one_active" ON "ExpertCert"("userId") WHERE "bindingStatus" = 'ACTIVE';

-- CheckConstraint: Claim 恰一 owner
ALTER TABLE "CaSigningCertificateClaim" ADD CONSTRAINT "claim_exactly_one_owner" CHECK (
  ("supplierId" IS NOT NULL AND "expertUserId" IS NULL) OR
  ("supplierId" IS NULL AND "expertUserId" IS NOT NULL)
);
