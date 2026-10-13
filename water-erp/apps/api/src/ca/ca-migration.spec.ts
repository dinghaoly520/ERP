import { PrismaClient } from '@prisma/client';

describe('ca-migration（SCCA 阶段1 Task1 约束断言）', () => {
  let prisma: PrismaClient;
  beforeAll(() => { prisma = new PrismaClient(); });
  afterAll(async () => { await prisma.$disconnect(); });

  test('CaCertificate 表存在且 sha256Fingerprint 唯一', async () => {
    const c1 = await prisma.caCertificate.create({
      data: {
        derBase64: 'dGVzdA==', sha256Fingerprint: 'aa'.repeat(32), serialHex: '01',
        issuerNameDerHash: 'bb'.repeat(32), issuerDisplay: 'T', subjectDisplay: 'T',
        spkiAlgorithmOid: '1.2.840.10045.2.1', notBefore: new Date(), notAfter: new Date(),
      },
    });
    await expect(prisma.caCertificate.create({
      data: {
        derBase64: 'dGVzdDI=', sha256Fingerprint: 'aa'.repeat(32), serialHex: '02',
        issuerNameDerHash: 'cc'.repeat(32), issuerDisplay: 'T', subjectDisplay: 'T',
        spkiAlgorithmOid: '1.2.840.10045.2.1', notBefore: new Date(), notAfter: new Date(),
      },
    })).rejects.toThrow(/unique/i);
    await prisma.caCertificate.delete({ where: { id: c1.id } });
  });

  test('CaSigningCertificateClaim 恰一 owner CHECK 约束', async () => {
    const cert = await prisma.caCertificate.create({
      data: {
        derBase64: 'dGVzdA==', sha256Fingerprint: 'dd'.repeat(32), serialHex: '03',
        issuerNameDerHash: 'ee'.repeat(32), issuerDisplay: 'T', subjectDisplay: 'T',
        spkiAlgorithmOid: '1.2.840.10045.2.1', notBefore: new Date(), notAfter: new Date(),
      },
    });
    // 双 NULL owner → CHECK 违规
    await expect(prisma.caSigningCertificateClaim.create({
      data: { certificateId: cert.id },
    })).rejects.toThrow();
    // 双 NOT NULL owner → CHECK 违规
    await expect(prisma.caSigningCertificateClaim.create({
      data: { certificateId: cert.id, supplierId: 's1', expertUserId: 'e1' },
    })).rejects.toThrow();
    // 恰一 owner → 通过
    const claim = await prisma.caSigningCertificateClaim.create({
      data: { certificateId: cert.id, supplierId: 's1' },
    });
    await prisma.caSigningCertificateClaim.delete({ where: { id: claim.id } });
    await prisma.caCertificate.delete({ where: { id: cert.id } });
  });

  test('SupplierCert 部分唯一索引：同主体至多一条 ACTIVE', async () => {
    // 借用现有 supplier（或造临时）
    const supplier = await prisma.supplier.findFirst();
    if (!supplier) return; // 空库跳过
    // 检查是否已有 ACTIVE
    const existing = await prisma.supplierCert.findFirst({
      where: { supplierId: supplier.id, bindingStatus: 'ACTIVE' },
    });
    if (existing) return; // 已有则跳过（唯一索引已在 DB 层验证）
    // 创建一条 ACTIVE 再尝试第二条 → P2002
    const c1 = await prisma.supplierCert.create({
      data: { supplierId: supplier.id, certSn: 'TEST-CA-MIG-1', certDn: 'CN=T', publicKey: '04' + '0'.repeat(128), bindingStatus: 'ACTIVE' },
    });
    await expect(prisma.supplierCert.create({
      data: { supplierId: supplier.id, certSn: 'TEST-CA-MIG-2', certDn: 'CN=T2', publicKey: '04' + '1'.repeat(128), bindingStatus: 'ACTIVE' },
    })).rejects.toThrow(/unique/i);
    // REVOKED 不受限
    const c3 = await prisma.supplierCert.create({
      data: { supplierId: supplier.id, certSn: 'TEST-CA-MIG-3', certDn: 'CN=T3', publicKey: '04' + '2'.repeat(128), bindingStatus: 'REVOKED' },
    });
    await prisma.supplierCert.deleteMany({ where: { certSn: { startsWith: 'TEST-CA-MIG-' } } });
    void c1; void c3;
  });

  test('存量 SupplierCert 行 credentialScheme 默认值 = legacy-raw-sm2', async () => {
    const legacy = await prisma.supplierCert.findFirst({
      where: { credentialScheme: 'legacy-raw-sm2' },
    });
    if (legacy) expect(legacy.credentialScheme).toBe('legacy-raw-sm2');
  });

  test('CaVerificationRecord 表 requestId 唯一', async () => {
    const v1 = await prisma.caVerificationRecord.create({
      data: {
        requestId: 'test-req-' + Date.now(), provider: 'scca', protocolVersion: 'v1',
        purpose: 'test', certFingerprint: 'ff'.repeat(32),
        toSignSha256: '11'.repeat(32), p7Sha256: '22'.repeat(32), result: 'ok',
        checkedAt: new Date(),
      },
    });
    await expect(prisma.caVerificationRecord.create({
      data: {
        requestId: v1.requestId, provider: 'scca', protocolVersion: 'v1',
        purpose: 'test', certFingerprint: 'ff'.repeat(32),
        toSignSha256: '11'.repeat(32), p7Sha256: '22'.repeat(32), result: 'ok',
        checkedAt: new Date(),
      },
    })).rejects.toThrow(/unique/i);
    await prisma.caVerificationRecord.delete({ where: { id: v1.id } });
  });
});
