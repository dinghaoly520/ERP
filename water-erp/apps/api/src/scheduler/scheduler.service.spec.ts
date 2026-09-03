import { buildExpiryNotification, SchedulerService } from './scheduler.service';
import { pendingBondReturnWhere } from '../bid/bond-pending.util';

describe('buildExpiryNotification', () => {
  it('生成到期提醒站内信', () => {
    const n = buildExpiryNotification({ qualificationName: '安全生产许可证', validTo: new Date('2026-07-10'), daysLeft: 26 });
    expect(n.type).toBe('QUALIFICATION_EXPIRING');
    expect(n.title).toContain('资质即将到期');
    expect(n.content).toContain('安全生产许可证');
    expect(n.content).toContain('26');
    expect(n.link).toBe('/supplier/qualifications');
  });
});

describe('autoNudgePendingBidders — 截止 24h（P0-2 第六写点）', () => {
  const makeScheduler = () => {
    const prisma: any = {
      bidProject: { findMany: jest.fn() },
      bidSupplier: { findMany: jest.fn() },
    };
    const notification: any = { create: jest.fn() };
    const scheduler = new SchedulerService(prisma, notification, {} as any, {} as any, {} as any, {} as any);
    return { scheduler, prisma, notification };
  };

  it('deadline 优先取 DB 值：frozen 延时项目真实截标已过 → 不再误发催促', async () => {
    const { scheduler, prisma, notification } = makeScheduler();
    const now = Date.now();
    // 真实截标 = 12h 前（已过）；延时后 openTime = 截标+24h = now+12h。
    // 旧实现按 openTime−12h = now 会落入窗口误催；DB deadline 已过 → 不催。
    prisma.bidProject.findMany.mockResolvedValue([
      { id: 'p1', name: '延时项目', openTime: new Date(now + 12 * 3600 * 1000), deadline: new Date(now - 12 * 3600 * 1000) },
    ]);
    await scheduler.autoNudgePendingBidders();
    expect(notification.create).not.toHaveBeenCalled();
  });

  it('deadline 缺失时按常量派生 openTime − 24h（不再按 12h 计算窗口）', async () => {
    const { scheduler, prisma, notification } = makeScheduler();
    const now = Date.now();
    // openTime − 24h = now+30min 落入窗口；若按旧 12h 反推 = now+12h30m 不落窗口 → 旧实现不发
    prisma.bidProject.findMany.mockResolvedValue([
      { id: 'p2', name: '常规项目', openTime: new Date(now + 24 * 3600 * 1000 + 30 * 60 * 1000), deadline: null },
    ]);
    prisma.bidSupplier.findMany.mockResolvedValue([{ supplier: { userId: 'u1' } }]);
    await scheduler.autoNudgePendingBidders();
    expect(notification.create).toHaveBeenCalledTimes(1);
    expect(notification.create.mock.calls[0][0].type).toBe('BID_DEADLINE_NUDGE');
  });

  it('DB deadline 在窗口内时按 DB 值发送（openTime−12h 已偏离也不受影响）', async () => {
    const { scheduler, prisma, notification } = makeScheduler();
    const now = Date.now();
    // openTime−12h = now+18h 不在窗口；DB deadline = now+30min 在窗口 → 按 DB 值催
    prisma.bidProject.findMany.mockResolvedValue([
      { id: 'p3', name: '对齐项目', openTime: new Date(now + 30 * 3600 * 1000), deadline: new Date(now + 30 * 60 * 1000) },
    ]);
    prisma.bidSupplier.findMany.mockResolvedValue([{ supplier: { userId: 'u1' } }]);
    await scheduler.autoNudgePendingBidders();
    expect(notification.create).toHaveBeenCalledTimes(1);
  });
});

describe('remindBondReturns — A-105 pending 口径（终审 Critical#2 共享谓词）', () => {
  const makeScheduler = () => {
    const prisma: any = {
      contract: { findMany: jest.fn() },
      bidProject: { findMany: jest.fn() },
      bidSupplier: { count: jest.fn(), findMany: jest.fn() },
      systemConfig: { findUnique: jest.fn(), upsert: jest.fn().mockResolvedValue({}) }, // 源码 upsert 链 .catch，须回 Promise
    };
    const notification: any = { create: jest.fn(), sendToRole: jest.fn().mockResolvedValue({}) }; // 源码 sendToRole 链 .catch，须回 Promise
    const scheduler = new SchedulerService(prisma, notification, {} as any, {} as any, {} as any, {} as any);
    return { scheduler, prisma, notification };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('count 与名单两处 where 都走共享谓词（已提交 + 未退还 + 无不予退还终局）', async () => {
    const { scheduler, prisma } = makeScheduler();
    prisma.contract.findMany.mockResolvedValue([{ projectId: 'p1' }]);
    prisma.bidProject.findMany.mockResolvedValue([{ id: 'p1', projectCode: 'GK-1', name: '项目一' }]);
    prisma.systemConfig.findUnique.mockResolvedValue(null);
    prisma.bidSupplier.count.mockResolvedValue(2);
    prisma.bidSupplier.findMany.mockResolvedValue([{ supplierName: '乙公司' }]);

    await scheduler.remindBondReturns();

    expect(prisma.bidSupplier.count).toHaveBeenCalledWith({ where: pendingBondReturnWhere({ projectId: 'p1' }) });
    expect(prisma.bidSupplier.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: pendingBondReturnWhere({ projectId: 'p1' }), select: { supplierName: true }, take: 5 }),
    );
  });

  it('不予退还（reason 有值）不计入 pending：仅剩终局/已退还/未提交行 → 视为收口不提醒', async () => {
    const { scheduler, prisma, notification } = makeScheduler();
    prisma.contract.findMany.mockResolvedValue([{ projectId: 'p1' }]);
    prisma.bidProject.findMany.mockResolvedValue([{ id: 'p1', projectCode: 'GK-1', name: '项目一' }]);
    prisma.systemConfig.findUnique.mockResolvedValue(null);
    // 内存实现 Prisma null 匹配语义：where 值为 null 的键要求行值恰为 null——旧口径（漏 bondReturnReason）
    // 会把「弄虚作假不予退还」行误计 1 家并发提醒；新谓词下 count=0 视为收口
    const rows = [
      { projectId: 'p1', supplierName: '甲公司', submitStatus: '已提交', bondReturnedAt: null, bondReturnReason: '弄虚作假' },
      { projectId: 'p1', supplierName: '乙公司', submitStatus: '已提交', bondReturnedAt: new Date(), bondReturnReason: null },
      { projectId: 'p1', supplierName: '丙公司', submitStatus: '待提交', bondReturnedAt: null, bondReturnReason: null },
    ];
    const matches = (where: any) =>
      rows.filter(r => Object.entries(where).every(([k, v]) => (v === null ? r[k] === null : JSON.stringify(r[k]) === JSON.stringify(v))));
    prisma.bidSupplier.count.mockImplementation(async ({ where }: any) => matches(where).length);

    await scheduler.remindBondReturns();

    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
    expect(notification.sendToRole).not.toHaveBeenCalled();
  });
});
