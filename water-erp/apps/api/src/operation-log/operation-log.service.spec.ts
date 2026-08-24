import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { OperationLogService } from './operation-log.service';

describe('OperationLogService', () => {
  let service: OperationLogService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      operationLog: { create: jest.fn(), findMany: jest.fn(), count: jest.fn(), deleteMany: jest.fn() },
      operationLogArchive: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
      $executeRawUnsafe: jest.fn(),
      $queryRaw: jest.fn(),
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [OperationLogService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(OperationLogService);
  });

  const sampleEntry = {
    userId: 'u1', username: '张三', role: 'bid_expert', portal: 'expert',
    method: 'POST', path: '/api/bid/score', query: null, body: { a: 1 },
    statusCode: 200, durationMs: 12, ipAddress: '1.2.3.4', userAgent: 'ua', referer: null, error: null,
  };

  it('create 透传给 prisma.operationLog.create', async () => {
    prisma.operationLog.create.mockResolvedValue({});
    await service.create(sampleEntry);
    expect(prisma.operationLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ path: '/api/bid/score', userId: 'u1' }) });
  });

  it('create 失败只 warn 不抛', async () => {
    prisma.operationLog.create.mockRejectedValue(new Error('db down'));
    await expect(service.create(sampleEntry)).resolves.toBeUndefined();
  });

  it('findAll 应用筛选 + 分页 + count', async () => {
    prisma.operationLog.findMany.mockResolvedValue([{ id: '1' }]);
    prisma.operationLog.count.mockResolvedValue(1);
    const r = await service.findAll({ role: 'bid_expert', path: '/score', limit: 10, offset: 5 });
    expect(prisma.operationLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ role: 'bid_expert', path: { contains: '/score' } }),
      take: 10, skip: 5,
    }));
    expect(r).toEqual({ items: [{ id: '1' }], total: 1 });
  });

  it('findMine 强制锁定 userId', async () => {
    prisma.operationLog.findMany.mockResolvedValue([]);
    prisma.operationLog.count.mockResolvedValue(0);
    await service.findMine('u1', { userId: 'hacker' });
    expect(prisma.operationLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'u1' }),
    }));
  });

  it('statusClass=server → statusCode gte 500 lt 600', async () => {
    prisma.operationLog.findMany.mockResolvedValue([]);
    prisma.operationLog.count.mockResolvedValue(0);
    await service.findAll({ statusClass: 'server' });
    expect(prisma.operationLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ statusCode: { gte: 500, lt: 600 } }),
    }));
  });

  it('startTime/endTime → createdAt 范围', async () => {
    prisma.operationLog.findMany.mockResolvedValue([]);
    prisma.operationLog.count.mockResolvedValue(0);
    await service.findAll({ startTime: '2026-01-01T00:00:00Z', endTime: '2026-02-01T00:00:00Z' });
    expect(prisma.operationLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ createdAt: { gte: new Date('2026-01-01T00:00:00Z'), lte: new Date('2026-02-01T00:00:00Z') } }),
    }));
  });

  it('默认 retentionDays=180 / monthsAhead=2（env 未设时）', () => {
    expect((service as any).retentionDays).toBe(180);
    expect((service as any).monthsAhead).toBe(2);
  });

  it('ensurePartitions 先搬 DEFAULT 越界行再幂等建当前+未来分区', async () => {
    prisma.$executeRawUnsafe.mockResolvedValue(0);
    await service.ensurePartitions();

    const now = new Date();
    const name = (offset: number) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
      return `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    };
    const sqls: string[] = prisma.$executeRawUnsafe.mock.calls.map((c) => c[0]);
    // monthsAhead=2 → 当前月+2 个未来月，每月 2 条（搬移 + 建分区）
    expect(sqls).toHaveLength(6);
    for (const k of [0, 1, 2]) {
      expect(sqls).toContainEqual(expect.stringContaining(`CREATE TABLE IF NOT EXISTS "OperationLog_${name(k)}" PARTITION OF "OperationLog" FOR VALUES FROM`));
    }
    // 每月的搬移 CTE 出现在该月 CREATE 之前（循环内 move→create 成对）
    expect(sqls[0]).toMatch(/^WITH moved AS/);
    expect(sqls[0]).toContain('DELETE FROM "OperationLog_default"'); // 搬移目标是 DEFAULT 分区
    expect(sqls[1]).toContain(`CREATE TABLE IF NOT EXISTS "OperationLog_${name(0)}"`);
  });

  it('dropExpiredPartitions 只 DROP 整月过期的月分区（跳过未来分区/DEFAULT/异常名）', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { relname: 'OperationLog_2020_01' }, // 远早于保留期 → DROP
      { relname: 'OperationLog_2999_01' }, // 未来 → 保留
      { relname: 'OperationLog_default' }, // 兜底分区 → 跳过
      { relname: 'junk' },                 // 异常名 → 跳过
    ]);
    prisma.$executeRawUnsafe.mockResolvedValue(0);
    await service.dropExpiredPartitions();
    const drops = prisma.$executeRawUnsafe.mock.calls.map((c) => c[0]).filter((s: string) => s.startsWith('DROP TABLE'));
    expect(drops).toEqual(['DROP TABLE IF EXISTS "OperationLog_2020_01"']);
  });

  it('purgeDefaultStragglers 按 5000 条/批循环直到删净', async () => {
    prisma.$executeRawUnsafe.mockResolvedValueOnce(5000).mockResolvedValueOnce(3);
    await service.purgeDefaultStragglers();
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    for (const [sql] of prisma.$executeRawUnsafe.mock.calls) {
      expect(sql).toContain('DELETE FROM "OperationLog_default"');
      expect(sql).toContain('LIMIT 5000');
    }
  });

  it('scheduledCleanup 串联三步且异常只 warn 不抛', async () => {
    prisma.$executeRawUnsafe.mockResolvedValue(0);
    prisma.$queryRaw.mockResolvedValue([]);
    await expect(service.scheduledCleanup()).resolves.toBeUndefined();
    expect(prisma.$queryRaw).toHaveBeenCalled(); // dropExpiredPartitions 执行过

    prisma.$executeRawUnsafe.mockRejectedValue(new Error('db down'));
    await expect(service.scheduledCleanup()).resolves.toBeUndefined();
  });
});

describe('OperationLogService P1-12 — archive-before-drop 法定留存', () => {
  let svc: any;
  let prisma: any;

  beforeEach(async () => {
    const { OperationLogService } = await import('./operation-log.service');
    const instance: any = Object.create(OperationLogService.prototype);
    // 直接构造不可行（private readonly 字段经 constructor）——用构造签名显式 mock prisma 后 new
    const { PrismaService } = await import('../prisma/prisma.service');
    instance.prisma = undefined;
    // 用 Object.create 后手动 set private 字段不可行（readonly TS 编译期，运行时可写）
    (instance as any).prisma = undefined;
    prisma = {
      operationLogArchive: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRawUnsafe: jest.fn(),
      $queryRaw: jest.fn(),
      $executeRawUnsafe: jest.fn(),
      operationLog: { create: jest.fn() },
    };
    instance.prisma = prisma;
    (instance as any).logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    (instance as any).retentionDays = 180;
    (instance as any).monthsAhead = 2;
    (instance as any).archiveEnabled = true;
    svc = instance;
  });

  it('归档成功后 DROP 分区；清单写入 rowCount/sha256', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([
      { id: 'l1', userId: 'u1', username: '甲', role: 'staff', portal: 'web', method: 'GET', path: '/x', query: null, body: null, statusCode: 200, durationMs: 5, ipAddress: '1.2.3.4', userAgent: 'ua', referer: null, error: null, createdAt: new Date('2026-01-15T00:00:00Z') },
    ]);
    prisma.$queryRaw.mockResolvedValue([{ relname: 'OperationLog_2025_11' }]);

    const { minioClient } = await import('../upload/minio.client');
    const putSpy = jest.spyOn(minioClient, 'putObject').mockResolvedValue({} as any);

    await svc.dropExpiredPartitions();

    expect(putSpy).toHaveBeenCalled();
    const putArgs = putSpy.mock.calls[0];
    expect(putArgs[1]).toBe('operation-log-archive/2025_11.jsonl.gz');
    expect(prisma.operationLogArchive.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ month: '2025_11', rowCount: 1, objectKey: 'operation-log-archive/2025_11.jsonl.gz', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }),
    });
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith('DROP TABLE IF EXISTS "OperationLog_2025_11"');
    putSpy.mockRestore();
  });

  it('归档失败 → 不 DROP（数据保留，下轮重试）', async () => {
    prisma.$queryRaw.mockResolvedValue([{ relname: 'OperationLog_2025_12' }]);
    prisma.$queryRawUnsafe.mockRejectedValue(new Error('partition read failed'));
    await svc.dropExpiredPartitions();
    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    expect((svc as any).logger.warn).toHaveBeenCalled();
  });

  it('幂等：该月已有归档清单 → 跳过导出直接 DROP', async () => {
    prisma.$queryRaw.mockResolvedValue([{ relname: 'OperationLog_2025_10' }]);
    prisma.operationLogArchive.findUnique.mockResolvedValue({ month: '2025_10', objectKey: 'k', rowCount: 0 });
    await svc.dropExpiredPartitions();
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled(); // 无 SELECT 导出
    expect(prisma.operationLogArchive.create).not.toHaveBeenCalled();
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith('DROP TABLE IF EXISTS "OperationLog_2025_10"');
  });

  it('空分区 → 占位清单（objectKey 空串）后 DROP', async () => {
    prisma.$queryRaw.mockResolvedValue([{ relname: 'OperationLog_2025_09' }]);
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    await svc.dropExpiredPartitions();
    expect(prisma.operationLogArchive.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ month: '2025_09', rowCount: 0, objectKey: '' }),
    });
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith('DROP TABLE IF EXISTS "OperationLog_2025_09"');
  });
});
