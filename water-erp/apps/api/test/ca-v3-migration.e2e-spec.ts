import 'dotenv/config'; // 裸 PrismaClient 不经 AppModule——自行加载 apps/api/.env（CI e2e job 写入、本地 dev 库）
import { PrismaClient } from '@prisma/client';

describe('ca-v3-migration（SCCA 阶段2 Task0 约束断言）', () => {
  let prisma: PrismaClient;
  beforeAll(() => { prisma = new PrismaClient(); });
  afterAll(async () => { await prisma.$disconnect(); });

  test('SubmissionVersion 唯一索引：同 submissionId+revision 不可重复', async () => {
    // I-1 修复：自建隔离行（不读 ambient 首行——真盾 E2E 后库中存在 revision≥1 的行会误红）
    const proj = await prisma.bidProject.create({
      data: { projectCode: 'SPEC-ISO-' + Date.now(), name: 'spec隔离', stage: 'DOWNLOAD', procurementMethod: '公开招标', deadline: new Date(Date.now() + 3600_000), openTime: new Date(Date.now() + 7200_000) },
    });
    const sub = await prisma.supplierBidSubmission.create({
      data: { supplierId: (await prisma.supplier.findFirst({ select: { id: true } }))!.id, projectId: proj.id, status: 'draft' },
    });
    try {
      const v1 = await prisma.submissionVersion.create({
        data: { submissionId: sub.id, revision: 1, envelope: { version: 'test' }, envelopeHash: 'aa'.repeat(32) },
      });
      await expect(prisma.submissionVersion.create({
        data: { submissionId: sub.id, revision: 1, envelope: { version: 'test' }, envelopeHash: 'bb'.repeat(32) },
      })).rejects.toThrow(/unique/i);
      await prisma.submissionVersion.delete({ where: { id: v1.id } });
    } finally {
      await prisma.supplierBidSubmission.delete({ where: { id: sub.id } }).catch(() => {});
      await prisma.bidProject.delete({ where: { id: proj.id } }).catch(() => {});
    }
  });

  test('DecryptExecution 槽位唯一：同 submissionId+revision+phase 不可重复', async () => {
    const d1 = await prisma.decryptExecution.create({
      data: { submissionId: 'test-sub', revision: 1, phase: 'outer', attemptId: 'a1' },
    });
    await expect(prisma.decryptExecution.create({
      data: { submissionId: 'test-sub', revision: 1, phase: 'outer', attemptId: 'a2' },
    })).rejects.toThrow(/unique/i);
    await prisma.decryptExecution.delete({ where: { id: d1.id } });
  });

  test('SupplierBidSubmission 有 revision 列且新建默认 0', async () => {
    // I-1 修复：自建行断言默认值（ambient 首行可能是真盾 E2E 的 revision=1 行）
    const proj = await prisma.bidProject.create({
      data: { projectCode: 'SPEC-ISO2-' + Date.now(), name: 'spec隔离2', stage: 'DOWNLOAD', procurementMethod: '公开招标', deadline: new Date(Date.now() + 3600_000), openTime: new Date(Date.now() + 7200_000) },
    });
    const sub = await prisma.supplierBidSubmission.create({
      data: { supplierId: (await prisma.supplier.findFirst({ select: { id: true } }))!.id, projectId: proj.id, status: 'draft' },
    });
    expect(sub.revision).toBe(0);
    await prisma.supplierBidSubmission.delete({ where: { id: sub.id } });
    await prisma.bidProject.delete({ where: { id: proj.id } });
  });

  test('Outbox 表可写入且默认 PENDING', async () => {
    const o = await prisma.outbox.create({ data: { topic: 'test', payload: { test: true } } });
    expect(o.status).toBe('PENDING');
    await prisma.outbox.delete({ where: { id: o.id } });
  });
});
