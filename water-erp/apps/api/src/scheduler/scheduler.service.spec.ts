import { buildExpiryNotification, buildCertExpiryNotification, SchedulerService, qualificationNoticeKey, parseQualificationNoticeKey } from './scheduler.service';
import { BID_DEADLINE_BEFORE_OPENING_MS } from '@water-erp/shared';
import { pendingBondReturnWhere } from '../bid/bond-pending.util';
import { formatLocalDate } from '../common/local-date-format.util';

describe('buildExpiryNotification', () => {
  it('生成到期提醒站内信', () => {
    const n = buildExpiryNotification({ qualificationName: '安全生产许可证', validTo: new Date('2026-07-10'), daysLeft: 26 });
    expect(n.type).toBe('QUALIFICATION_EXPIRING');
    expect(n.title).toContain('资质到期');
    expect(n.content).toContain('安全生产许可证');
    expect(n.content).toContain('26');
    expect(n.link).toBe('/profile');
  });
});

describe('autoNudgePendingBidders — 截止 24h（P0-2 第六写点）', () => {
  const makeScheduler = () => {
    const prisma: any = {
      bidProject: { findMany: jest.fn() },
      bidSupplier: { findMany: jest.fn() },
    };
    const notification: any = { create: jest.fn() };
    const scheduler = new SchedulerService(prisma, notification, {} as any, {} as any, {} as any);
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

  it('deadline 缺失时按常量派生 openTime − 常量（常量口径；不再按 12h 计算窗口）', async () => {
    const { scheduler, prisma, notification } = makeScheduler();
    const now = Date.now();
    // openTime − 10min = now+30min 落入窗口；若按旧 12h 反推 = now−11h20m 不落窗口 → 旧实现不发
    prisma.bidProject.findMany.mockResolvedValue([
      { id: 'p2', name: '常规项目', openTime: new Date(now + BID_DEADLINE_BEFORE_OPENING_MS + 30 * 60 * 1000), deadline: null },
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

describe('scanConfirmTimeouts — #61回归A 确认超时扫描（10min cron 薄壳）', () => {
  const makeScheduler = () => {
    const prisma: any = {
      bidOpeningSession: { findMany: jest.fn() },
      bidProject: { findMany: jest.fn() },
    };
    const bidService: any = {
      autoCloseExpiredConfirmations: jest.fn().mockResolvedValue(undefined),
      autoHandoverIfDone: jest.fn().mockResolvedValue(undefined),
    };
    const scheduler = new SchedulerService(prisma, {} as any, {} as any, {} as any, bidService);
    return { scheduler, prisma, bidService };
  };

  it('无过期会话 → 零调用', async () => {
    const { scheduler, prisma, bidService } = makeScheduler();
    prisma.bidOpeningSession.findMany.mockResolvedValue([]);
    await scheduler.scanConfirmTimeouts();
    expect(bidService.autoCloseExpiredConfirmations).not.toHaveBeenCalled();
  });

  it('过期会话+OPENING 项目 → 闭环后触发自动固化（全静默场景无需人工）', async () => {
    const { scheduler, prisma, bidService } = makeScheduler();
    prisma.bidOpeningSession.findMany.mockResolvedValue([{ projectId: 'p1' }]);
    prisma.bidProject.findMany.mockResolvedValue([{ id: 'p1' }]);
    await scheduler.scanConfirmTimeouts();
    expect(bidService.autoCloseExpiredConfirmations).toHaveBeenCalledWith('p1');
    expect(bidService.autoHandoverIfDone).toHaveBeenCalledWith('p1', '确认超时扫描');
  });

  it('会话过期但项目已非 OPENING → 过滤不触发；单项目异常不中断批次', async () => {
    const { scheduler, prisma, bidService } = makeScheduler();
    prisma.bidOpeningSession.findMany.mockResolvedValue([{ projectId: 'pX' }]);
    prisma.bidProject.findMany.mockResolvedValue([]); // 全被 stage 过滤
    await scheduler.scanConfirmTimeouts();
    expect(bidService.autoCloseExpiredConfirmations).not.toHaveBeenCalled();

    prisma.bidProject.findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
    bidService.autoCloseExpiredConfirmations.mockRejectedValueOnce(new Error('db hiccup'));
    await scheduler.scanConfirmTimeouts(); // p1 抛错被吞，p2 照常
    expect(bidService.autoHandoverIfDone).toHaveBeenCalledTimes(1);
    expect(bidService.autoHandoverIfDone).toHaveBeenCalledWith('p2', '确认超时扫描');
  });
});

describe('remindBondReturns — A-105 pending 口径（终审 Critical#2 共享谓词）', () => {
  const makeScheduler = () => {
    const prisma: any = {
      contract: { findMany: jest.fn() },
      bidProject: { findMany: jest.fn() },
      bidSupplier: { count: jest.fn(), findMany: jest.fn() },
      projectManagementItem: { findUnique: jest.fn().mockResolvedValue(null) },
      systemConfig: { findUnique: jest.fn(), upsert: jest.fn().mockResolvedValue({}) }, // 源码 upsert 链 .catch，须回 Promise
    };
    const notification: any = { create: jest.fn(), sendToRole: jest.fn().mockResolvedValue({}), sendToUser: jest.fn().mockResolvedValue({}) }; // 源码发送链 .catch，须回 Promise
    const scheduler = new SchedulerService(prisma, notification, {} as any, {} as any, {} as any);
    return { scheduler, prisma, notification };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('count 与名单两处 where 都走共享谓词（已提交 + 未退还 + 无不予退还终局）', async () => {
    const { scheduler, prisma } = makeScheduler();
    prisma.contract.findMany.mockResolvedValue([{ projectId: 'p1' }]);
    prisma.bidProject.findMany.mockResolvedValue([{ id: 'p1', projectCode: 'GK-1', name: '项目一', projectManagementItemId: 'pm1' }]);
    prisma.projectManagementItem.findUnique.mockResolvedValue({ createdById: 'creator-1', createdBy: { isActive: true } });
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

  it('D2：逐项目定向创建人（2026-10-09 串号修复）——两项目各发各的创建人，5 家截断带「…」', async () => {
    const { scheduler, prisma, notification } = makeScheduler();
    prisma.contract.findMany.mockResolvedValue([{ projectId: 'p1' }, { projectId: 'p2' }]);
    prisma.bidProject.findMany.mockResolvedValue([
      { id: 'p1', projectCode: 'GK-1', name: '项目一', projectManagementItemId: 'pm1' },
      { id: 'p2', projectCode: 'GK-2', name: '项目二', projectManagementItemId: 'pm2' },
    ]);
    prisma.systemConfig.findUnique.mockResolvedValue(null);
    prisma.bidSupplier.count.mockResolvedValue(6); // 触发 slice(0,5)+「…」截断
    prisma.bidSupplier.findMany.mockResolvedValue([
      { supplierName: '甲公司' }, { supplierName: '乙公司' }, { supplierName: '丙公司' }, { supplierName: '丁公司' }, { supplierName: '戊公司' },
    ]);
    prisma.projectManagementItem.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === 'pm1' ? { createdById: 'creator-1', createdBy: { isActive: true } } : { createdById: 'creator-2', createdBy: { isActive: true } },
    );

    await scheduler.remindBondReturns();

    // 不再按 staff 全平台广播；两项目各定向自己的创建人
    expect(notification.sendToRole).not.toHaveBeenCalled();
    expect(notification.sendToUser).toHaveBeenCalledTimes(2);
    const [p1Call, p2Call] = notification.sendToUser.mock.calls;
    expect(p1Call[0]).toBe('creator-1');
    // 深链直达（2026-11-03 与定标即时通道同款）：有 PMI id → /projects?projectId=…
    expect(p1Call[2]).toMatchObject({ type: 'BOND_REFUND_DUE', link: '/projects?projectId=pm1' });
    expect(p1Call[2].content).toContain('项目一（GK-1）尚有 6 家');
    expect(p1Call[2].content).toContain('甲公司、乙公司、丙公司、丁公司、戊公司…。');
    expect(p2Call[0]).toBe('creator-2');
    expect(p2Call[2].content).toContain('项目二（GK-2）');
    // marker 在成功发送后逐项目写入（失败不占坑）
    expect(prisma.systemConfig.upsert).toHaveBeenCalledTimes(2);
  });

  it('创建人不可解析（无宿主 PMI）→ 跳过不发送且不占坑（明日重扫）', async () => {
    const { scheduler, prisma, notification } = makeScheduler();
    prisma.contract.findMany.mockResolvedValue([{ projectId: 'p1' }]);
    prisma.bidProject.findMany.mockResolvedValue([{ id: 'p1', projectCode: 'GK-1', name: '项目一', projectManagementItemId: null }]);
    prisma.systemConfig.findUnique.mockResolvedValue(null);
    prisma.bidSupplier.count.mockResolvedValue(2);

    await scheduler.remindBondReturns();

    expect(notification.sendToRole).not.toHaveBeenCalled();
    expect(notification.sendToUser).not.toHaveBeenCalled();
    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
  });

  it('创建人已停用（isActive=false）→ 跳过不发送且不占坑（法定提醒不被死信空耗）', async () => {
    const { scheduler, prisma, notification } = makeScheduler();
    prisma.contract.findMany.mockResolvedValue([{ projectId: 'p1' }]);
    prisma.bidProject.findMany.mockResolvedValue([{ id: 'p1', projectCode: 'GK-1', name: '项目一', projectManagementItemId: 'pm1' }]);
    prisma.projectManagementItem.findUnique.mockResolvedValue({ createdById: 'creator-1', createdBy: { isActive: false } });
    prisma.systemConfig.findUnique.mockResolvedValue(null);
    prisma.bidSupplier.count.mockResolvedValue(2);

    await scheduler.remindBondReturns();

    expect(notification.sendToRole).not.toHaveBeenCalled();
    expect(notification.sendToUser).not.toHaveBeenCalled();
    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
  });
});

describe('publishScheduledAnnouncements — P0-2 走 announcementService.update 发布闸门', () => {
  const makeScheduler = () => {
    const prisma: any = {
      // announcement.updateMany 仅限 metadata 留痕（2026-11-23 失败原因持久化/自愈清除；2026-11-24 改带
      // 状态条件）——status 转 PUBLISHED 仍专属 announcementService.update（P0-2 旁路禁令不变）
      announcement: { findMany: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    // findUnique（发布前复核/留痕前取最新元数据）默认回 findMany 最近一次给的那批行——镜像真实库
    prisma.announcement.findUnique = jest.fn(async ({ where }: any) =>
      ((await prisma.announcement.findMany()) as any[]).find((r) => r.id === where.id) ?? null);
    const notification: any = { create: jest.fn().mockResolvedValue({}) };
    const announcementService: any = {
      update: jest.fn().mockResolvedValue({ id: 'a1', status: 'PUBLISHED' }),
      notifySuppliersOnPublish: jest.fn().mockResolvedValue({}),
    };
    const scheduler = new SchedulerService(prisma, notification, {} as any, announcementService, {} as any);
    return { scheduler, prisma, notification, announcementService };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('到期草稿委托 update({status:PUBLISHED, publishDate:now})；cron 侧不再另发通知（update 内部已含）', async () => {
    const { scheduler, prisma, announcementService } = makeScheduler();
    prisma.announcement.findMany.mockResolvedValue([
      { id: 'a1', title: '预成交公示', type: 'PRE_WIN_NOTICE', status: 'DRAFT', metadata: { scheduledPublishDate: new Date(Date.now() - 60_000).toISOString() } },
    ]);
    await scheduler.publishScheduledAnnouncements();
    expect(announcementService.update).toHaveBeenCalledTimes(1);
    const [id, dto] = announcementService.update.mock.calls[0];
    expect(id).toBe('a1');
    expect(dto.status).toBe('PUBLISHED');
    expect(new Date(dto.publishDate).getTime()).toBeGreaterThan(Date.now() - 60_000);
    // 发布通知由 update() 内部负责——cron 不得重复直发
    expect(announcementService.notifySuppliersOnPublish).not.toHaveBeenCalled();
  });

  it('update 抛错（如时限/赋码闸拒绝）→ 记录错误、不中断后续条目（违规草稿保持 DRAFT 待修正）', async () => {
    const { scheduler, prisma, announcementService } = makeScheduler();
    prisma.announcement.findMany.mockResolvedValue([
      { id: 'bad', title: '违规招标公告', type: 'BID_NOTICE', status: 'DRAFT', metadata: { scheduledPublishDate: new Date(Date.now() - 60_000).toISOString() } },
      { id: 'ok', title: '常规公告', type: 'POLICY', status: 'DRAFT', metadata: { scheduledPublishDate: new Date(Date.now() - 60_000).toISOString() } },
    ]);
    announcementService.update.mockImplementation(async (id: string) => {
      if (id === 'bad') throw new Error('依法必招项目：招标文件出售开始至开标须不少于 20 日');
      return { id, status: 'PUBLISHED' };
    });
    await expect(scheduler.publishScheduledAnnouncements()).resolves.toBeUndefined();
    expect(announcementService.update).toHaveBeenCalledTimes(2);
  });

  it('未到期 / 无 scheduledPublishDate 的草稿不动', async () => {
    const { scheduler, prisma, announcementService } = makeScheduler();
    prisma.announcement.findMany.mockResolvedValue([
      { id: 'future', title: '未到期', type: 'POLICY', status: 'DRAFT', metadata: { scheduledPublishDate: new Date(Date.now() + 3600_000).toISOString() } },
      { id: 'plain', title: '普通草稿', type: 'POLICY', status: 'DRAFT', metadata: {} },
    ]);
    await scheduler.publishScheduledAnnouncements();
    expect(announcementService.update).not.toHaveBeenCalled();
  });

  // ── 失败原因持久化 + 通知创建人（2026-11-23 优化：UI 从「请检查」变为显示实际原因）──

  it('发布被闸拒绝 → 失败原因（HttpException response.error 优先）持久化到 metadata.scheduledPublishError + 首次通知创建人', async () => {
    const { scheduler, prisma, notification, announcementService } = makeScheduler();
    prisma.announcement.findMany.mockResolvedValue([
      { id: 'a9', title: '询比公告', type: 'INQUIRY_NOTICE', status: 'DRAFT', authorId: 'author-1', metadata: { scheduledPublishDate: new Date(Date.now() - 60_000).toISOString() } },
    ]);
    announcementService.update.mockRejectedValue(Object.assign(new Error('Http Exception'), {
      response: { error: '项目未取得国标采购编码（gbProcureCode）且自动补码失败', code: 'GB_CODE_REQUIRED' },
    }));
    await scheduler.publishScheduledAnnouncements();

    expect(prisma.announcement.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'a9', status: 'DRAFT' },
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          scheduledPublishError: expect.objectContaining({
            message: '项目未取得国标采购编码（gbProcureCode）且自动补码失败',
            code: 'GB_CODE_REQUIRED',
          }),
        }),
      }),
    }));
    expect(notification.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'author-1',
      type: 'SCHEDULED_PUBLISH_FAILED',
      content: expect.stringContaining('国标采购编码'),
    }));
  });

  it('同错误重试 → 不重复写库、不重复通知（每分钟重试的写放大/通知风暴收敛到原因变化）', async () => {
    const { scheduler, prisma, notification, announcementService } = makeScheduler();
    const meta = {
      scheduledPublishDate: new Date(Date.now() - 60_000).toISOString(),
      scheduledPublishError: { message: '同一原因', code: 'X', at: new Date().toISOString() },
    };
    prisma.announcement.findMany.mockResolvedValue([
      { id: 'a9', title: '滞留件', type: 'POLICY', status: 'DRAFT', authorId: 'author-1', metadata: meta },
    ]);
    announcementService.update.mockRejectedValue(Object.assign(new Error('x'), { response: { error: '同一原因', code: 'X' } }));
    await scheduler.publishScheduledAnnouncements();
    expect(prisma.announcement.updateMany).not.toHaveBeenCalled();
    expect(notification.create).not.toHaveBeenCalled();
  });

  it('失败后自愈成功 → 清除残留失败标记（仅 metadata，status 仍由 announcementService.update 落）', async () => {
    const { scheduler, prisma, notification, announcementService } = makeScheduler();
    prisma.announcement.findMany.mockResolvedValue([
      { id: 'a9', title: '自愈件', type: 'POLICY', status: 'DRAFT', authorId: 'author-1',
        metadata: { scheduledPublishDate: new Date(Date.now() - 60_000).toISOString(), scheduledPublishError: { message: '旧原因', code: 'X', at: new Date().toISOString() } } },
    ]);
    // 发布前复核读到草稿态；发布联动之后库里那一行是 PUBLISHED（夹具默认回快照行，这里照真实状态变化覆写）
    const marked = { scheduledPublishDate: new Date(Date.now() - 60_000).toISOString(), scheduledPublishError: { message: '旧原因', code: 'X', at: 't' } };
    let published = false;
    prisma.announcement.findUnique.mockImplementation(async () => (published ? { status: 'PUBLISHED', metadata: marked } : { status: 'DRAFT', metadata: marked }));
    announcementService.update.mockImplementation(async () => { published = true; return { id: 'a9', status: 'PUBLISHED' }; });
    await scheduler.publishScheduledAnnouncements();
    const arg = prisma.announcement.updateMany.mock.calls[0][0];
    // 清标记落在已发布的那一行（带状态条件），只动 metadata
    expect(arg.where).toEqual({ id: 'a9', status: 'PUBLISHED' });
    expect(arg.data.metadata.scheduledPublishError).toBeUndefined();
    expect(arg.data.status).toBeUndefined(); // cron 直写不得碰 status
    expect(notification.create).not.toHaveBeenCalled();
  });
});

describe('publishScheduledAnnouncements — 待发定时草稿冲突兜底（2026-11-24 用户裁定）', () => {
  // 用户裁定：兜底不替经办人选择。同项目同类型出现多条待发定时草稿时系统无从判定哪条正确——
  // 一条都不发，全部写失败原因并通知经办人；经办人保留一条、隐藏其余后，保留的那条下一分钟自动发出。
  // 生产实录：XCZY-XB-2026112302 两条定时草稿（04 向导两次「确认发布」）同刻到期，各发一条、31 家供应商收两遍通知。
  const makeScheduler = () => {
    const prisma: any = { announcement: { findMany: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    // 复核/留痕取最新元数据：默认回 findMany 最近一次给的那批行（单个用例可覆写以模拟「快照之后变了」）
    prisma.announcement.findUnique = jest.fn(async ({ where }: any) =>
      ((await prisma.announcement.findMany()) as any[]).find((r) => r.id === where.id) ?? null);
    const notification: any = { create: jest.fn().mockResolvedValue({}) };
    const announcementService: any = { update: jest.fn().mockResolvedValue({ id: 'x', status: 'PUBLISHED' }) };
    const scheduler = new SchedulerService(prisma, notification, {} as any, announcementService, {} as any);
    const errorLog = jest.spyOn((scheduler as any).logger, 'error').mockImplementation(() => undefined);
    return { scheduler, prisma, notification, announcementService, errorLog };
  };
  const CODE = 'XCZY-XB-2026112302';
  const past = () => new Date(Date.now() - 60_000).toISOString();
  const future = () => new Date(Date.now() + 3_600_000).toISOString();
  const draft = (id: string, scheduledPublishDate: string, extra: Record<string, any> = {}) => ({
    id, title: '询比采购公告 — 外立面清洗服务项目', type: 'BID_NOTICE', status: 'DRAFT', authorId: 'author-1',
    relatedProjectCode: CODE, metadata: { scheduledPublishDate }, ...extra,
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('同项目同类型两条待发草稿同时到期 → 一条都不发，两条都写失败原因并各通知创建人', async () => {
    const { scheduler, prisma, notification, announcementService } = makeScheduler();
    prisma.announcement.findMany.mockResolvedValue([draft('a', past()), draft('b', past())]);
    await scheduler.publishScheduledAnnouncements();
    expect(announcementService.update).not.toHaveBeenCalled();
    const writes = prisma.announcement.updateMany.mock.calls.map((c) => c[0]);
    expect(writes.map((w) => w.where.id).sort()).toEqual(['a', 'b']);
    for (const w of writes) {
      expect(w.data.status).toBeUndefined(); // cron 直写不得碰 status
      expect(w.data.metadata.scheduledPublishDate).toBeTruthy(); // 定时保留：经办人处理后据此自动发出
      expect(w.data.metadata.scheduledPublishError).toMatchObject({ code: 'SCHEDULED_DUPLICATE_PENDING' });
    }
    expect(notification.create).toHaveBeenCalledTimes(2);
    expect(notification.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'author-1', type: 'SCHEDULED_PUBLISH_FAILED' }));
  });

  it('冲突通知给出的处理办法必须是「隐藏多余的」——不得沿用发布失败的建议让经办人重新发布（那会被互斥闸 409 拒绝）', async () => {
    const { scheduler, prisma, notification } = makeScheduler();
    prisma.announcement.findMany.mockResolvedValue([draft('a', past()), draft('b', past())]);
    await scheduler.publishScheduledAnnouncements();
    const content: string = notification.create.mock.calls[0][0].content;
    expect(content).toContain('隐藏');
    expect(content).not.toContain('切回立即发布');
    expect(content).not.toContain('重新发布');
  });

  it('同键冲突未到点也提前发现：写失败原因并通知，给经办人留处理时间，不触发发布', async () => {
    const { scheduler, prisma, notification, announcementService } = makeScheduler();
    // 两条都未到点（相差两小时）——用例名说的是「未到点也提前发现」，数据也得两条都未到点
    const later = new Date(Date.now() + 7_200_000).toISOString();
    prisma.announcement.findMany.mockResolvedValue([draft('a', future()), draft('b', later)]);
    await scheduler.publishScheduledAnnouncements();
    expect(announcementService.update).not.toHaveBeenCalled();
    expect(prisma.announcement.updateMany.mock.calls.map((c) => c[0].where.id).sort()).toEqual(['a', 'b']);
    expect(notification.create).toHaveBeenCalledTimes(2);
  });

  it('到期时间不同也算冲突（一条 09:00、一条 10:00）：先到的那条不得先发，否则到点又发一条', async () => {
    const { scheduler, prisma, announcementService } = makeScheduler();
    prisma.announcement.findMany.mockResolvedValue([draft('a', future()), draft('b', past(), { metadata: { scheduledPublishDate: past() } })]);
    await scheduler.publishScheduledAnnouncements();
    expect(announcementService.update).not.toHaveBeenCalled();
  });

  it('经办人隐藏多余的一条后：保留的那条已到期 → 下一轮自动发出并清除失败标记', async () => {
    const { scheduler, prisma, notification, announcementService } = makeScheduler();
    const meta = {
      scheduledPublishDate: past(),
      scheduledPublishError: { message: '旧标记', code: 'SCHEDULED_DUPLICATE_PENDING', at: new Date().toISOString() },
    };
    prisma.announcement.findMany.mockResolvedValue([draft('a', past(), { metadata: meta })]);
    // 发布前复核读到草稿态；发布之后那一行是 PUBLISHED（清标记落在已发布的行上）
    let published = false;
    prisma.announcement.findUnique.mockImplementation(async () => (published ? { status: 'PUBLISHED', metadata: meta } : { status: 'DRAFT', metadata: meta }));
    announcementService.update.mockImplementation(async () => { published = true; return { id: 'a', status: 'PUBLISHED' }; });
    await scheduler.publishScheduledAnnouncements();
    expect(announcementService.update).toHaveBeenCalledWith('a', expect.objectContaining({ status: 'PUBLISHED' }));
    const arg = prisma.announcement.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'a', status: 'PUBLISHED' });
    expect(arg.data.metadata.scheduledPublishError).toBeUndefined();
    expect(notification.create).not.toHaveBeenCalled();
  });

  it('冲突已解除但还没到点 → 清掉残留的冲突标记（不再误标红），不触发发布', async () => {
    const { scheduler, prisma, announcementService } = makeScheduler();
    prisma.announcement.findMany.mockResolvedValue([
      draft('a', future(), { metadata: {
        scheduledPublishDate: future(),
        scheduledPublishError: { message: '旧标记', code: 'SCHEDULED_DUPLICATE_PENDING', at: new Date().toISOString() },
      } }),
    ]);
    await scheduler.publishScheduledAnnouncements();
    expect(announcementService.update).not.toHaveBeenCalled();
    const arg = prisma.announcement.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'a', status: 'DRAFT' }); // 仍是草稿的那一行
    expect(arg.data.metadata.scheduledPublishError).toBeUndefined();
    expect(arg.data.status).toBeUndefined();
  });

  // 各自的破坏点：分组不看类型→①误拦；不看项目编号→②误拦；变更/补遗不带轮次→③④误拦；无项目编号入组→⑤误拦
  it.each<[string, object, object]>([
    ['同项目不同类型', draft('a', past()), draft('b', past(), { type: 'FAILED_BID_NOTICE' })],
    ['不同项目同类型', draft('a', past()), draft('b', past(), { relatedProjectCode: 'OTHER-XB-1' })],
    ['同项目变更公告不同轮次（数字与字符串轮次同值）', draft('a', past(), { type: 'CHANGE_NOTICE', metadata: { scheduledPublishDate: past(), changeRound: 1 } }), draft('b', past(), { type: 'CHANGE_NOTICE', metadata: { scheduledPublishDate: past(), changeRound: '2' } })],
    ['同项目补遗公告不同轮次', draft('a', past(), { type: 'ADDENDUM', metadata: { scheduledPublishDate: past(), changeRound: '1' } }), draft('b', past(), { type: 'ADDENDUM', metadata: { scheduledPublishDate: past(), changeRound: '2' } })],
    ['无项目编号的手工公告（标题相同）', { ...draft('a', past()), relatedProjectCode: null }, { ...draft('b', past()), relatedProjectCode: null }],
  ])('不构成冲突的到点草稿照常发布 — %s', async (_label, first, second) => {
    const { scheduler, prisma, announcementService, notification } = makeScheduler();
    prisma.announcement.findMany.mockResolvedValue([first, second]);
    await scheduler.publishScheduledAnnouncements();
    expect(announcementService.update).toHaveBeenCalledTimes(2);
    expect(prisma.announcement.updateMany).not.toHaveBeenCalled();
    expect(notification.create).not.toHaveBeenCalled();
  });

  // ── 审查修复（2026-11-24）：整分钟开头的快照不能直接拿来发布和写标记 ──
  // 破坏点：循环逐条处理可能耗时数秒（建招标文件转 PDF、项目联动），期间经办人隐藏了某条、或「替换」
  // 把旧草稿移入了回收站——按快照继续 update 就把刚隐藏的草稿发出去（生产事故同形），留痕还会把
  // 回收站标记冲掉
  it.each<[string, Record<string, any>]>([
    ['被经办人隐藏', { status: 'HIDDEN' }],
    ['被「替换」移入回收站后下架', { status: 'OFFLINE' }],
  ])('快照之后草稿%s → 不再发布、不写标记、不通知', async (_label, fresh) => {
    const { scheduler, prisma, notification, announcementService } = makeScheduler();
    // slow 属另一个项目（互斥键不同），不受 a 的变化影响，照常发布
    prisma.announcement.findMany.mockResolvedValue([draft('slow', past(), { relatedProjectCode: 'OTHER-XB-9' }), draft('a', past())]);
    prisma.announcement.findUnique.mockImplementation(async ({ where }: any) => (where.id === 'a' ? { ...fresh, metadata: { scheduledPublishDate: past() } } : { status: 'DRAFT', metadata: { scheduledPublishDate: past() } }));
    await scheduler.publishScheduledAnnouncements();
    expect(announcementService.update.mock.calls.map((c) => c[0])).toEqual(['slow']);
    expect(prisma.announcement.updateMany).not.toHaveBeenCalled();
    expect(notification.create).not.toHaveBeenCalled();
  });

  it.each<[string, Record<string, any> | null]>([
    ['取消了定时', { status: 'DRAFT', metadata: {} }],
    ['把定时改到了未来', { status: 'DRAFT', metadata: { scheduledPublishDate: future() } }],
    ['被删除', null],
  ])('快照之后草稿%s → 到点的那次不发布', async (_label, fresh) => {
    const { scheduler, prisma, announcementService } = makeScheduler();
    // slow 属另一个项目（互斥键不同），不受 a 的变化影响，照常发布
    prisma.announcement.findMany.mockResolvedValue([draft('slow', past(), { relatedProjectCode: 'OTHER-XB-9' }), draft('a', past())]);
    prisma.announcement.findUnique.mockImplementation(async ({ where }: any) => (where.id === 'a' ? fresh : { status: 'DRAFT', metadata: { scheduledPublishDate: past() } }));
    await scheduler.publishScheduledAnnouncements();
    expect(announcementService.update.mock.calls.map((c) => c[0])).toEqual(['slow']);
  });

  it('发布在即发现已在回收站（复核与发布之间的窗口）→ 静默跳过，不写标记不通知', async () => {
    const { scheduler, prisma, notification, announcementService } = makeScheduler();
    prisma.announcement.findMany.mockResolvedValue([draft('a', past())]);
    announcementService.update.mockRejectedValue(Object.assign(new Error('x'), { response: { error: '公告已在回收站中', code: 'ANNOUNCEMENT_IN_RECYCLE' } }));
    await scheduler.publishScheduledAnnouncements();
    expect(prisma.announcement.updateMany).not.toHaveBeenCalled();
    expect(notification.create).not.toHaveBeenCalled();
  });

  it('发布被互斥闸拒绝（快照之后才出现的同键待发）→ 不按发布失败留痕（那条建议会让经办人重新发布而被拒），下一轮按冲突处理', async () => {
    const { scheduler, prisma, notification, announcementService } = makeScheduler();
    prisma.announcement.findMany.mockResolvedValue([draft('a', past())]);
    announcementService.update.mockRejectedValue(Object.assign(new Error('x'), { response: { error: '同项目同类型已有 1 条定时待发公告', code: 'SCHEDULED_ANNOUNCEMENT_EXISTS' } }));
    await scheduler.publishScheduledAnnouncements();
    expect(prisma.announcement.updateMany).not.toHaveBeenCalled();
    expect(notification.create).not.toHaveBeenCalled();
  });

  it('清除残留标记以最新元数据为准：发布联动写入的键（如中标候选人）不得被快照覆盖掉', async () => {
    const { scheduler, prisma, announcementService } = makeScheduler();
    prisma.announcement.findMany.mockResolvedValue([
      draft('a', past(), { metadata: { scheduledPublishDate: past(), scheduledPublishError: { message: '旧标记', code: 'X', at: 't' } } }),
    ]);
    // 复核时（发布前）读到草稿态；发布联动之后库里的最新行：标记仍在，且写入了 winCandidates
    let published = false;
    prisma.announcement.findUnique.mockImplementation(async () => (published
      ? { status: 'PUBLISHED', metadata: { scheduledPublishDate: past(), scheduledPublishError: { message: '旧标记', code: 'X', at: 't' }, winCandidates: [{ name: '甲' }] } }
      : { status: 'DRAFT', metadata: { scheduledPublishDate: past() } }));
    announcementService.update.mockImplementation(async () => { published = true; return { id: 'a', status: 'PUBLISHED' }; });
    await scheduler.publishScheduledAnnouncements();
    expect(announcementService.update).toHaveBeenCalledTimes(1);
    const arg = prisma.announcement.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'a', status: 'PUBLISHED' });
    expect(arg.data.metadata.scheduledPublishError).toBeUndefined();
    expect(arg.data.metadata.winCandidates).toEqual([{ name: '甲' }]);
  });

  it('写冲突标记：带状态条件（仅仍是草稿才写），且不覆盖快照之后写入的其他键', async () => {
    const { scheduler, prisma } = makeScheduler();
    prisma.announcement.findMany.mockResolvedValue([draft('a', past()), draft('b', past())]);
    prisma.announcement.findUnique.mockImplementation(async ({ where }: any) => ({ status: 'DRAFT', authorId: 'author-1', title: '询比采购公告 — 外立面清洗服务项目', metadata: { scheduledPublishDate: past(), visibility: 'PUBLIC' } }));
    await scheduler.publishScheduledAnnouncements();
    for (const call of prisma.announcement.updateMany.mock.calls) {
      expect(call[0].where).toMatchObject({ status: 'DRAFT' });
      expect(call[0].data.status).toBeUndefined();
      expect(call[0].data.metadata.visibility).toBe('PUBLIC');
    }
  });

  it('冲突原因把处理办法放在最前：列表里截断显示时，经办人仍看得到该做什么', async () => {
    const { scheduler, prisma } = makeScheduler();
    prisma.announcement.findMany.mockResolvedValue([draft('a', past()), draft('b', past())]);
    await scheduler.publishScheduledAnnouncements();
    const reason: string = prisma.announcement.updateMany.mock.calls[0][0].data.metadata.scheduledPublishError.message;
    expect(reason.slice(0, 16)).toContain('隐藏');
    expect(reason).toContain('2 条');
  });

  it('冲突原因不变 → 不重复写库、不重复通知', async () => {
    const { scheduler, prisma, notification, announcementService } = makeScheduler();
    // 先跑一轮拿到系统写入的失败原因，再把该原因原样放回库中模拟「下一分钟」
    prisma.announcement.findMany.mockResolvedValue([draft('a', past()), draft('b', past())]);
    await scheduler.publishScheduledAnnouncements();
    const marked = prisma.announcement.updateMany.mock.calls.map((c) => c[0].data.metadata);
    prisma.announcement.updateMany.mockClear();
    notification.create.mockClear();
    prisma.announcement.findMany.mockResolvedValue([
      { ...draft('a', past()), metadata: marked[0] },
      { ...draft('b', past()), metadata: marked[1] },
    ]);
    await scheduler.publishScheduledAnnouncements();
    expect(announcementService.update).not.toHaveBeenCalled();
    expect(prisma.announcement.updateMany).not.toHaveBeenCalled();
    expect(notification.create).not.toHaveBeenCalled();
  });

  it('同一发布失败原因每分钟重试 → 错误日志只打一次（不再每分钟刷屏）', async () => {
    const { scheduler, prisma, announcementService, errorLog } = makeScheduler();
    prisma.announcement.findMany.mockResolvedValue([draft('a', past(), { metadata: { scheduledPublishDate: past(), scheduledPublishError: { message: '同一原因', code: 'X', at: new Date().toISOString() } } })]);
    announcementService.update.mockRejectedValue(Object.assign(new Error('x'), { response: { error: '同一原因', code: 'X' } }));
    await scheduler.publishScheduledAnnouncements();
    await scheduler.publishScheduledAnnouncements();
    expect(announcementService.update).toHaveBeenCalledTimes(2); // 每分钟照常重试（闸门解除即自愈）
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('首次发布失败打一条错误日志；同一原因下一分钟重试不再打（上面的用例从「已留痕」起步，测不到首打）', async () => {
    const { scheduler, prisma, announcementService, errorLog } = makeScheduler();
    prisma.announcement.findMany.mockResolvedValue([draft('a', past())]); // 尚无失败标记
    announcementService.update.mockRejectedValue(Object.assign(new Error('x'), { response: { error: '首次失败原因', code: 'X' } }));
    await scheduler.publishScheduledAnnouncements();
    expect(errorLog).toHaveBeenCalledTimes(1);
    // 下一分钟：库里已留痕同一原因
    prisma.announcement.findMany.mockResolvedValue([draft('a', past(), { metadata: { scheduledPublishDate: past(), scheduledPublishError: { message: '首次失败原因', code: 'X', at: 't' } } })]);
    await scheduler.publishScheduledAnnouncements();
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it('发布失败原因变化 → 重新打错误日志', async () => {
    const { scheduler, prisma, announcementService, errorLog } = makeScheduler();
    prisma.announcement.findMany.mockResolvedValue([draft('a', past(), { metadata: { scheduledPublishDate: past(), scheduledPublishError: { message: '旧原因', code: 'X', at: new Date().toISOString() } } })]);
    announcementService.update.mockRejectedValue(Object.assign(new Error('x'), { response: { error: '新原因', code: 'Y' } }));
    await scheduler.publishScheduledAnnouncements();
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(String(errorLog.mock.calls[0][0])).toContain('新原因');
  });
});

describe('buildCertExpiryNotification（A-13）', () => {
  it('即将到期：30 天档文案含证书序列号与剩余天数', () => {
    const n = buildCertExpiryNotification({ certSn: 'MOCK-AB12CD34', expiresAt: new Date('2026-11-16T00:00:00Z'), daysLeft: 60, expired: false });
    expect(n.type).toBe('CERT_EXPIRY_REMINDER');
    expect(n.title).toContain('即将到期');
    expect(n.content).toContain('MOCK-AB12CD34');
    expect(n.content).toContain('60');
    expect(n.link).toBe('/profile/ukey');
  });

  it('已过期：文案为「已过期」且不含剩余天数话术', () => {
    const n = buildCertExpiryNotification({ certSn: 'SHD-B14EF038', expiresAt: new Date('2026-09-01T00:00:00Z'), daysLeft: 0, expired: true });
    expect(n.title).toBe('CA 证书已过期');
    expect(n.content).toContain('已于');
    expect(n.content).not.toContain('剩 ');
  });
});

describe('scanExpiringQualifications — 7 天幂等（2026-11-04 堆积治理）', () => {
  const DAY = 24 * 3600 * 1000;
  const makeScheduler = () => {
    const prisma: any = {
      supplierQualification: { findMany: jest.fn() },
      notification: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const notification: any = { create: jest.fn() };
    const scheduler = new SchedulerService(prisma, notification, {} as any, {} as any, {} as any);
    return { scheduler, prisma, notification };
  };

  it('7 天内已提醒同资质（同到期日）→ 跳过；换证后新到期日 → 照常提醒', async () => {
    const { scheduler, prisma, notification } = makeScheduler();
    const now = Date.now();
    const sameValidTo = new Date(now + 10 * DAY);
    const renewedValidTo = new Date(now + 25 * DAY);
    prisma.supplierQualification.findMany.mockResolvedValue([
      { name: '安全生产许可证', validTo: sameValidTo, status: '有效', supplier: { userId: 'u1' } },
      { name: '安全生产许可证', validTo: renewedValidTo, status: '有效', supplier: { userId: 'u2' } },
    ]);
    prisma.notification.findMany.mockResolvedValue([
      { userId: 'u1', content: `您的资质材料「安全生产许可证」将于 ${formatLocalDate(sameValidTo)} 到期（剩 10 天），请及时更新以免影响投标资格。` },
    ]);
    await scheduler.scanExpiringQualifications();
    expect(notification.create).toHaveBeenCalledTimes(1); // u1 跳过、u2 换证新键照发
    expect(notification.create.mock.calls[0][0].userId).toBe('u2');
  });

  it('手动维护通道文案（已于 X 到期）同样反解命中——手动提醒后 7 天内扫描不重复', async () => {
    const { scheduler, prisma, notification } = makeScheduler();
    const now = Date.now();
    const validTo = new Date(now + 10 * DAY);
    prisma.supplierQualification.findMany.mockResolvedValue([
      { name: '水利水电工程施工总承包壹级', validTo, status: '有效', supplier: { userId: 'u1' } },
    ]);
    prisma.notification.findMany.mockResolvedValue([
      { userId: 'u1', content: `您的资质材料「水利水电工程施工总承包壹级」已于 ${formatLocalDate(validTo)} 到期，请及时更新以免影响投标资格。` },
    ]);
    await scheduler.scanExpiringQualifications();
    expect(notification.create).not.toHaveBeenCalled();
  });

  it('无近期通知 → 全量发送；近期查询限定 7 天窗口与类型', async () => {
    const { scheduler, prisma, notification } = makeScheduler();
    const now = Date.now();
    prisma.supplierQualification.findMany.mockResolvedValue([
      { name: '安全生产许可证', validTo: new Date(now + 10 * DAY), status: '有效', supplier: { userId: 'u1' } },
      { name: '资质证书乙', validTo: new Date(now + 20 * DAY), status: '有效', supplier: { userId: 'u2' } },
    ]);
    await scheduler.scanExpiringQualifications();
    expect(notification.create).toHaveBeenCalledTimes(2);
    const recentWhere = prisma.notification.findMany.mock.calls[0][0].where;
    expect(recentWhere.type).toBe('QUALIFICATION_EXPIRING');
    expect(new Date(recentWhere.createdAt.gte).getTime()).toBeGreaterThan(Date.now() - 8 * DAY);
  });

  it('幂等键正反解析对称；不匹配文案回 null 不入去重集', () => {
    const validTo = new Date('2026-11-15T00:00:00');
    const key = qualificationNoticeKey('u1', '安全生产许可证', validTo);
    expect(parseQualificationNoticeKey('u1', `您的资质材料「安全生产许可证」将于 ${formatLocalDate(validTo)} 到期（剩 10 天），请及时更新以免影响投标资格。`)).toBe(key);
    expect(parseQualificationNoticeKey('u1', `您的资质材料「安全生产许可证」已于 ${formatLocalDate(validTo)} 到期，请及时更新以免影响投标资格。`)).toBe(key);
    expect(parseQualificationNoticeKey('u1', '其他无关文案')).toBeNull();
  });
});

describe('scanSupplierCertExpiry — 档位幂等推进', () => {
  const makeScheduler = () => {
    const prisma: any = {
      supplierCert: { findMany: jest.fn(), update: jest.fn() },
      supplier: { findUnique: jest.fn().mockResolvedValue({ userId: 'u-supplier' }) },
    };
    const notification: any = { create: jest.fn() };
    const scheduler = new SchedulerService(prisma, notification, {} as any, {} as any, {} as any);
    return { scheduler, prisma, notification };
  };
  const DAY = 24 * 3600 * 1000;

  it('剩 20 天 stage=0 → 发 30 天档并推 stage=1', async () => {
    const { scheduler, prisma, notification } = makeScheduler();
    prisma.supplierCert.findMany.mockResolvedValue([
      { id: 'c1', supplierId: 's1', certSn: 'MOCK-A', expiresAt: new Date(Date.now() + 20 * DAY), expiryNotifyStage: 0 },
    ]);
    await scheduler.scanSupplierCertExpiry();
    expect(notification.create).toHaveBeenCalledTimes(1);
    expect(notification.create.mock.calls[0][0].title).toContain('即将到期');
    expect(prisma.supplierCert.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { expiryNotifyStage: 1 } });
  });

  it('剩 5 天 stage=1 → 升级 7 天档推 stage=2；stage 已达 2 不再发（幂等）', async () => {
    const { scheduler, prisma, notification } = makeScheduler();
    prisma.supplierCert.findMany.mockResolvedValue([
      { id: 'c2', supplierId: 's2', certSn: 'MOCK-B', expiresAt: new Date(Date.now() + 5 * DAY), expiryNotifyStage: 1 },
      { id: 'c3', supplierId: 's3', certSn: 'MOCK-C', expiresAt: new Date(Date.now() + 5 * DAY), expiryNotifyStage: 2 },
    ]);
    await scheduler.scanSupplierCertExpiry();
    expect(notification.create).toHaveBeenCalledTimes(1); // 仅 c2 升级；c3 幂等跳过
    expect(prisma.supplierCert.update).toHaveBeenCalledTimes(1);
    expect(prisma.supplierCert.update).toHaveBeenCalledWith({ where: { id: 'c2' }, data: { expiryNotifyStage: 2 } });
  });

  it('已过期 stage=0 → 直接发「已过期」并推 stage=2（最多 2 条语义的终点档）', async () => {
    const { scheduler, prisma, notification } = makeScheduler();
    prisma.supplierCert.findMany.mockResolvedValue([
      { id: 'c4', supplierId: 's4', certSn: 'MOCK-D', expiresAt: new Date(Date.now() - DAY), expiryNotifyStage: 0 },
    ]);
    await scheduler.scanSupplierCertExpiry();
    expect(notification.create.mock.calls[0][0].title).toBe('CA 证书已过期');
    expect(prisma.supplierCert.update).toHaveBeenCalledWith({ where: { id: 'c4' }, data: { expiryNotifyStage: 2 } });
  });

  it('剩 45 天（未入 30 天窗）→ 不发不推', async () => {
    const { scheduler, prisma, notification } = makeScheduler();
    prisma.supplierCert.findMany.mockResolvedValue([
      { id: 'c5', supplierId: 's5', certSn: 'MOCK-E', expiresAt: new Date(Date.now() + 45 * DAY), expiryNotifyStage: 0 },
    ]);
    await scheduler.scanSupplierCertExpiry();
    expect(notification.create).not.toHaveBeenCalled();
    expect(prisma.supplierCert.update).not.toHaveBeenCalled();
  });
});
