import 'dotenv/config'; // 裸 PrismaClient 不经 AppModule——自行加载 apps/api/.env（CI e2e job 写入、本地 dev 库）
import { PrismaClient } from '@prisma/client';

describe('ca-v3-ops-migration（阶段2.5 Task0 约束断言）', () => {
  let prisma: PrismaClient;
  beforeAll(() => { prisma = new PrismaClient(); });
  afterAll(async () => { await prisma.$disconnect(); });

  test('BidFileBackup.revision 列存在且默认 0（v2 存量行为不变）', async () => {
    const cols = await prisma.$queryRaw<Array<{ column_default: string | null }>>`
      SELECT column_default FROM information_schema.columns
      WHERE table_name = 'BidFileBackup' AND column_name = 'revision'`;
    expect(cols).toHaveLength(1);
    expect(cols[0]!.column_default).toContain('0');
  });

  test('BidFileBackup 唯一键：新 [projectId,supplierId,fileRole,revision] 在位；旧三列键已撤', async () => {
    const idx = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'BidFileBackup'`;
    const defs = idx.map(r => r.indexdef);
    expect(defs.some(d => d.includes('BidFileBackup_projectId_supplierId_fileRole_revision_key'))).toBe(true);
    expect(defs.some(d => d.includes('BidFileBackup_supplierId_projectId_fileRole_key'))).toBe(false);
  });

  test('Outbox.attempts 默认 0 + lastError 可空（消费退避）', async () => {
    const cols = await prisma.$queryRaw<Array<{ column_name: string; column_default: string | null; is_nullable: string }>>`
      SELECT column_name, column_default, is_nullable FROM information_schema.columns
      WHERE table_name = 'Outbox' AND column_name IN ('attempts', 'lastError')`;
    const byName = new Map(cols.map(c => [c.column_name, c]));
    expect(byName.get('attempts')?.column_default).toContain('0');
    expect(byName.get('lastError')?.is_nullable).toBe('YES');
  });
});
