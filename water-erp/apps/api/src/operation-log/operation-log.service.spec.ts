import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { OperationLogService } from './operation-log.service';

describe('OperationLogService', () => {
  let service: OperationLogService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      operationLog: { create: jest.fn(), findMany: jest.fn(), count: jest.fn(), deleteMany: jest.fn() },
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

  it('scheduledCleanup 按 retentionDays 删除旧记录', async () => {
    prisma.operationLog.deleteMany.mockResolvedValue({ count: 3 });
    await service.scheduledCleanup();
    expect(prisma.operationLog.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) } },
    });
  });
});
