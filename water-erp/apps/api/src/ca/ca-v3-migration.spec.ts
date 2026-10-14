import { PrismaClient } from '@prisma/client';

describe('ca-v3-migration（SCCA 阶段2 Task0 约束断言）', () => {
  let prisma: PrismaClient;
  beforeAll(() => { prisma = new PrismaClient(); });
  afterAll(async () => { await prisma.$disconnect(); });

  test('SubmissionVersion 唯一索引：同 submissionId+revision 不可重复', async () => {
    const sub = await prisma.supplierBidSubmission.findFirst();
    if (!sub) return;
    const v1 = await prisma.submissionVersion.create({
      data: { submissionId: sub.id, revision: 1, envelope: { version: 'test' }, envelopeHash: 'aa'.repeat(32) },
    });
    await expect(prisma.submissionVersion.create({
      data: { submissionId: sub.id, revision: 1, envelope: { version: 'test' }, envelopeHash: 'bb'.repeat(32) },
    })).rejects.toThrow(/unique/i);
    await prisma.submissionVersion.delete({ where: { id: v1.id } });
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

  test('SupplierBidSubmission 有 revision 列且默认 0', async () => {
    const sub = await prisma.supplierBidSubmission.findFirst({ select: { revision: true } });
    if (sub !== null) expect(sub.revision).toBe(0);
  });

  test('Outbox 表可写入且默认 PENDING', async () => {
    const o = await prisma.outbox.create({ data: { topic: 'test', payload: { test: true } } });
    expect(o.status).toBe('PENDING');
    await prisma.outbox.delete({ where: { id: o.id } });
  });
});
