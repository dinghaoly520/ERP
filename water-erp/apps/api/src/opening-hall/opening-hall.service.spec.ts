import { Test } from '@nestjs/testing';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { OpeningHallService, HOST_ROLES_SET } from './opening-hall.service';
import { PrismaService } from '../prisma/prisma.service';
import { BidGateway } from '../bid/bid.gateway';
import { NotificationService } from '../notification/notification.service';

const prismaMock = {
  // 回调式事务：tx 即 prismaMock 自身（与 bid.service.spec 同模式）
  $transaction: jest.fn(async (fn: any) => fn(prismaMock)),
  bidProject: { findUnique: jest.fn() },
  bidOpeningSession: { findUnique: jest.fn(), update: jest.fn() },
  bidSupplier: { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
  openingHallMessage: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
  openingHallReadCursor: { upsert: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
  bidSupervisionLog: { create: jest.fn() },
  supplier: { findFirst: jest.fn() },
} as any;
const gatewayMock = {
  notifyHallMessage: jest.fn(), notifyHallCheckin: jest.fn(),
  notifyExchangeControl: jest.fn(), broadcastHallPresence: jest.fn(),
  getOnlineSupplierIds: jest.fn().mockReturnValue(new Set()),
} as any;
const notificationMock = { create: jest.fn() } as any;

const host = { userId: 'u-host', role: 'bid_host', supplierId: undefined, supplierName: undefined };
const sup = { userId: 'u-sup', role: 'supplier', supplierId: 'sup-1', supplierName: '测试供应商' };
const outsider = { userId: 'u-expert', role: 'bid_expert', supplierId: undefined, supplierName: undefined };

function setup() {
  prismaMock.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'OPENING' });
  prismaMock.bidOpeningSession.findUnique.mockResolvedValue({ projectId: 'p1', exchangeControl: 'OPEN' });
  prismaMock.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierId: 'sup-1', supplierName: '测试供应商', checkInAt: null });
  prismaMock.bidSupplier.updateMany.mockResolvedValue({ count: 1 }); // R6：默认抢占成功（首签）
  prismaMock.bidSupplier.findUnique.mockResolvedValue({ checkInAt: null });
  prismaMock.openingHallMessage.create.mockImplementation(async ({ data }: any) => ({ ...data, id: 'm1', createdAt: new Date('2026-07-23T00:00:00Z') }));
}

describe('OpeningHallService', () => {
  let svc: OpeningHallService;
  beforeEach(async () => {
    jest.clearAllMocks();
    const mod = await Test.createTestingModule({
      providers: [
        OpeningHallService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: BidGateway, useValue: gatewayMock },
        { provide: NotificationService, useValue: notificationMock },
      ],
    }).compile();
    svc = mod.get(OpeningHallService);
    setup();
  });

  it('OPENING 阶段公聊发送成功并广播', async () => {
    const msg = await svc.sendMessage(host, 'p1', { roomType: 'PUBLIC', content: '请各家准备解密' });
    expect(msg.content).toBe('请各家准备解密');
    expect(gatewayMock.notifyHallMessage).toHaveBeenCalledWith('p1', expect.objectContaining({ roomType: 'PUBLIC' }));
  });

  it('非 OPENING 阶段发消息 → 403 HALL_CLOSED', async () => {
    prismaMock.bidProject.findUnique.mockResolvedValue({ id: 'p1', stage: 'EVALUATING' });
    await expect(svc.sendMessage(host, 'p1', { roomType: 'PUBLIC', content: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('MUTED 时供应商发言 → 403；主持人仍可发', async () => {
    prismaMock.bidOpeningSession.findUnique.mockResolvedValue({ projectId: 'p1', exchangeControl: 'MUTED' });
    await expect(svc.sendMessage(sup, 'p1', { roomType: 'PUBLIC', content: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.sendMessage(host, 'p1', { roomType: 'PUBLIC', content: 'x' })).resolves.toBeDefined();
  });

  it('CLOSED 时全员禁言', async () => {
    prismaMock.bidOpeningSession.findUnique.mockResolvedValue({ projectId: 'p1', exchangeControl: 'CLOSED' });
    await expect(svc.sendMessage(host, 'p1', { roomType: 'PUBLIC', content: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('供应商私聊只能发自己的会话', async () => {
    await expect(svc.sendMessage(sup, 'p1', { roomType: 'PRIVATE', supplierId: 'sup-2', content: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('私聊 supplierId 必须参投本项目', async () => {
    prismaMock.bidSupplier.findFirst.mockResolvedValue(null);
    await expect(svc.sendMessage(host, 'p1', { roomType: 'PRIVATE', supplierId: 'sup-9', content: 'x' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('S4：纯文本频道原文落库——& < > 不转义、<script> 作字面文本保留（渲染侧转义是前端职责）', async () => {
    const msg = await svc.sendMessage(host, 'p1', { roomType: 'PUBLIC', content: '报价 <100> 万元 & 工期' });
    expect(msg.content).toBe('报价 <100> 万元 & 工期'); // 不再是 报价 &lt;100&gt; 万元 &amp; 工期
    const script = await svc.sendMessage(host, 'p1', { roomType: 'PUBLIC', content: '<script>x</script>' });
    expect(script.content).toBe('<script>x</script>'); // 不再被富文本消毒器剥成空串
  });

  it('S5：纯空白消息 → 400 MESSAGE_EMPTY（不落库不广播）', async () => {
    await expect(svc.sendMessage(host, 'p1', { roomType: 'PUBLIC', content: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.sendMessage(host, 'p1', { roomType: 'PUBLIC', content: '   ' })).rejects.toMatchObject({
      response: { code: 'MESSAGE_EMPTY' },
    });
    expect(prismaMock.openingHallMessage.create).not.toHaveBeenCalled();
    expect(gatewayMock.notifyHallMessage).not.toHaveBeenCalled();
  });

  it('S4：2000 边界码点安全截断——emoji 代理对不被切断', async () => {
    const content = '字'.repeat(1999) + '💥'; // UTF-16 码元 2001 个；旧 .slice(0,2000) 会切断 💥 代理对
    const msg = await svc.sendMessage(host, 'p1', { roomType: 'PUBLIC', content });
    expect([...msg.content].length).toBeLessThanOrEqual(2000); // 按码点计长
    expect(/\p{Surrogate}/u.test(msg.content)).toBe(false);    // 无孤立代理字符
    expect(msg.content.endsWith('💥')).toBe(true);              // emoji 完整保留
  });

  describe('listMessages 分页健壮化（S6）', () => {
    it('非法 cursor → 400 INVALID_CURSOR（不进 Prisma，不再 500）', async () => {
      await expect(svc.listMessages(host, 'p1', { roomType: 'PUBLIC', cursor: 'abc' })).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.listMessages(host, 'p1', { roomType: 'PUBLIC', cursor: 'abc' })).rejects.toMatchObject({
        response: { code: 'INVALID_CURSOR' },
      });
      expect(prismaMock.openingHallMessage.findMany).not.toHaveBeenCalled();
    });

    it('limit=NaN → 回落默认 50（findMany take=51）', async () => {
      prismaMock.openingHallMessage.findMany.mockResolvedValue([]);
      await svc.listMessages(host, 'p1', { roomType: 'PUBLIC', limit: NaN });
      expect(prismaMock.openingHallMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 51 }));
    });

    it('复合游标 createdAt|id → where 带 OR 翻页条件、orderBy 双键降序', async () => {
      prismaMock.openingHallMessage.findMany.mockResolvedValue([]);
      const t = new Date('2026-07-23T00:00:00.000Z');
      await svc.listMessages(host, 'p1', { roomType: 'PUBLIC', cursor: `${t.toISOString()}|m-9` });
      expect(prismaMock.openingHallMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { createdAt: { lt: t } },
            { createdAt: { equals: t }, id: { lt: 'm-9' } },
          ],
        }),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }));
    });

    it('旧格式游标（无 |）向后兼容：按纯时间翻页（id 分支恒不命中）', async () => {
      prismaMock.openingHallMessage.findMany.mockResolvedValue([]);
      const t = new Date('2026-07-23T00:00:00.000Z');
      await svc.listMessages(host, 'p1', { roomType: 'PUBLIC', cursor: t.toISOString() });
      expect(prismaMock.openingHallMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { createdAt: { lt: t } },
            { createdAt: { equals: t }, id: { lt: '' } },
          ],
        }),
      }));
    });

    it('同毫秒翻页不丢消息：nextCursor=ISO|id，第二页续取同毫秒后续行', async () => {
      const t = new Date('2026-07-23T00:00:00.000Z');
      prismaMock.openingHallMessage.findMany
        .mockResolvedValueOnce([
          { id: 'm3', createdAt: t, content: '3' },
          { id: 'm2', createdAt: t, content: '2' },
          { id: 'm1', createdAt: t, content: '1' }, // take=3 命中 → hasMore
        ])
        .mockResolvedValueOnce([{ id: 'm1', createdAt: t, content: '1' }]);
      const r1 = await svc.listMessages(host, 'p1', { roomType: 'PUBLIC', limit: 2 });
      expect(r1.nextCursor).toBe(`${t.toISOString()}|m2`);
      const r2 = await svc.listMessages(host, 'p1', { roomType: 'PUBLIC', limit: 2, cursor: r1.nextCursor! });
      // 旧纯时间游标在此场景会丢 m1（createdAt < t 恒假）；复合游标续取无丢失
      expect([...r1.items, ...r2.items].map((m: any) => m.id)).toEqual(['m2', 'm3', 'm1']);
      expect(r2.nextCursor).toBeNull();
    });
  });

  it('签到幂等：已签到直接返回原时间', async () => {
    const t = new Date('2026-07-23T01:00:00Z');
    prismaMock.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierId: 'sup-1', supplierName: '测试供应商', checkInAt: t });
    const res = await svc.checkIn(sup, 'p1', { ip: '1.2.3.4', ua: 'test' });
    expect(res.checkInAt.toISOString()).toBe(t.toISOString());
    expect(prismaMock.bidSupplier.update).not.toHaveBeenCalled();
  });

  it('签到成功写监督日志并广播', async () => {
    const res = await svc.checkIn(sup, 'p1', { ip: '1.2.3.4', ua: 'test' });
    expect(res.checkInAt).toBeInstanceOf(Date);
    expect(prismaMock.bidSupervisionLog.create).toHaveBeenCalled();
    expect(gatewayMock.notifyHallCheckin).toHaveBeenCalled();
  });

  it('非主持非供应商角色：发言/历史/未读/在场全部 403 HOST_ONLY', async () => {
    await expect(svc.sendMessage(outsider, 'p1', { roomType: 'PUBLIC', content: 'x' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.listMessages(outsider, 'p1', { roomType: 'PUBLIC' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.listMessages(outsider, 'p1', { roomType: 'PRIVATE', supplierId: 'sup-1' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.unreadCounts(outsider, 'p1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.presence('p1', outsider)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prismaMock.openingHallMessage.create).not.toHaveBeenCalled();
  });

  it('非参投供应商发公聊 → 400 NOT_PROJECT_MEMBER（不落库）', async () => {
    prismaMock.bidSupplier.findFirst.mockResolvedValue(null);
    await expect(svc.sendMessage(sup, 'p1', { roomType: 'PUBLIC', content: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.openingHallMessage.create).not.toHaveBeenCalled();
  });

  it('供应商读他人私聊转录仍被原有 PRIVATE_ROOM_MISMATCH 拒绝（角色门放行供应商）', async () => {
    await expect(svc.listMessages(sup, 'p1', { roomType: 'PRIVATE', supplierId: 'sup-2' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('交流控制切换写库+监督日志+广播', async () => {
    await svc.setExchangeControl('p1', 'MUTED', '陈源远');
    expect(prismaMock.bidOpeningSession.update).toHaveBeenCalledWith({ where: { projectId: 'p1' }, data: { exchangeControl: 'MUTED' } });
    expect(gatewayMock.notifyExchangeControl).toHaveBeenCalled();
  });

  describe('markRead 归属门（S7）', () => {
    it('supplier 写 public 与自身 roomKey → upsert 落库', async () => {
      await svc.markRead(sup, 'p1', 'public');
      expect(prismaMock.openingHallReadCursor.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { projectId_userId_roomKey: { projectId: 'p1', userId: 'u-sup', roomKey: 'public' } },
      }));
      await svc.markRead(sup, 'p1', 'supplier:sup-1');
      expect(prismaMock.openingHallReadCursor.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { projectId_userId_roomKey: { projectId: 'p1', userId: 'u-sup', roomKey: 'supplier:sup-1' } },
      }));
    });

    it('supplier 写他人 roomKey → 403 ROOM_KEY_FORBIDDEN（不落库）', async () => {
      await expect(svc.markRead(sup, 'p1', 'supplier:sup-2')).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.markRead(sup, 'p1', 'supplier:sup-2')).rejects.toMatchObject({
        response: { code: 'ROOM_KEY_FORBIDDEN' },
      });
      expect(prismaMock.openingHallReadCursor.upsert).not.toHaveBeenCalled();
    });

    it('host 写 public 与参投成员 roomKey → upsert 落库', async () => {
      await svc.markRead(host, 'p1', 'public');
      await svc.markRead(host, 'p1', 'supplier:sup-1'); // setup() 中 findFirst 返回参投成员
      expect(prismaMock.openingHallReadCursor.upsert).toHaveBeenCalledTimes(2);
      expect(prismaMock.bidSupplier.findFirst).toHaveBeenCalledWith({ where: { projectId: 'p1', supplierId: 'sup-1' } });
    });

    it('host 写非参投成员 roomKey → 400 NOT_PROJECT_MEMBER（不落库）', async () => {
      prismaMock.bidSupplier.findFirst.mockResolvedValue(null);
      await expect(svc.markRead(host, 'p1', 'supplier:sup-9')).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.markRead(host, 'p1', 'supplier:sup-9')).rejects.toMatchObject({
        response: { code: 'NOT_PROJECT_MEMBER' },
      });
      expect(prismaMock.openingHallReadCursor.upsert).not.toHaveBeenCalled();
    });

    it('其他角色（bid_expert）写游标 → 403 HOST_ONLY', async () => {
      await expect(svc.markRead(outsider, 'p1', 'public')).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.markRead(outsider, 'p1', 'public')).rejects.toMatchObject({
        response: { code: 'HOST_ONLY' },
      });
      expect(prismaMock.openingHallReadCursor.upsert).not.toHaveBeenCalled();
    });

    it('项目不存在 → 400 NOT_FOUND（不落库）', async () => {
      prismaMock.bidProject.findUnique.mockResolvedValue(null);
      await expect(svc.markRead(sup, 'p-ghost', 'public')).rejects.toBeInstanceOf(BadRequestException);
      await expect(svc.markRead(sup, 'p-ghost', 'public')).rejects.toMatchObject({
        response: { code: 'NOT_FOUND' },
      });
      expect(prismaMock.openingHallReadCursor.upsert).not.toHaveBeenCalled();
    });
  });

  describe('markRead 已读末条游标（R5：防"拉历史→markRead"窗口内消息被误判已读）', () => {
    const t1 = new Date('2026-07-24T10:00:00.000Z');
    const t2 = new Date('2026-07-24T10:00:01.000Z');
    const t3 = new Date('2026-07-24T10:00:02.000Z');
    const msgs = [
      { id: 'M1', projectId: 'p1', roomType: 'PUBLIC', supplierId: null, createdAt: t1 },
      { id: 'M2', projectId: 'p1', roomType: 'PUBLIC', supplierId: null, createdAt: t2 },
      { id: 'M3', projectId: 'p1', roomType: 'PUBLIC', supplierId: null, createdAt: t3 },
    ];

    beforeEach(() => {
      // 消息命中：仅同项目同会话的 id 命中（跨项目/跨会话乱报 → null → 回退 now()）
      prismaMock.openingHallMessage.findFirst.mockImplementation(async ({ where }: any) =>
        msgs.find(m =>
          m.id === where.id && m.projectId === where.projectId && m.roomType === where.roomType &&
          (where.supplierId === undefined || m.supplierId === where.supplierId),
        ) ?? null);
      // 游标表：upsert 落库 → findUnique 读回；count 按 createdAt > 游标过滤
      const cursors = new Map<string, Date>();
      prismaMock.openingHallReadCursor.upsert.mockImplementation(async ({ where, create, update }: any) => {
        const k = where.projectId_userId_roomKey;
        const at = update?.lastReadAt ?? create.lastReadAt;
        cursors.set(`${k.projectId}|${k.userId}|${k.roomKey}`, at);
        return { ...k, lastReadAt: at };
      });
      prismaMock.openingHallReadCursor.findUnique.mockImplementation(async ({ where }: any) => {
        const k = where.projectId_userId_roomKey;
        const at = cursors.get(`${k.projectId}|${k.userId}|${k.roomKey}`);
        return at ? { ...k, lastReadAt: at } : null;
      });
      prismaMock.openingHallMessage.count.mockImplementation(async ({ where }: any) =>
        msgs.filter(m =>
          m.projectId === where.projectId && m.roomType === where.roomType &&
          (where.supplierId === undefined || m.supplierId === where.supplierId) &&
          (!where.createdAt || m.createdAt.getTime() > where.createdAt.gt.getTime()),
        ).length);
    });

    it('上报已读末条 M2 → 游标定在 M2.createdAt，未读仅 M3（1 条）', async () => {
      await svc.markRead(sup, 'p1', 'public', 'M2');
      expect(prismaMock.openingHallMessage.findFirst).toHaveBeenCalledWith({
        where: { id: 'M2', projectId: 'p1', roomType: 'PUBLIC' },
      });
      expect(prismaMock.openingHallReadCursor.upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({ lastReadAt: t2 }),
        update: expect.objectContaining({ lastReadAt: t2 }),
      }));
      const unread = await svc.unreadCounts(sup, 'p1');
      expect(unread.public).toBe(1); // 仅 M3；旧 now() 实现会把 M3 也误判已读
    });

    it('私聊 roomKey 上报末条 → findFirst 带 supplierId 限定（防跨会话 id 乱报）', async () => {
      await svc.markRead(sup, 'p1', 'supplier:sup-1', 'M1');
      expect(prismaMock.openingHallMessage.findFirst).toHaveBeenCalledWith({
        where: { id: 'M1', projectId: 'p1', roomType: 'PRIVATE', supplierId: 'sup-1' },
      });
    });

    it('未知 lastMessageId → 回退 now()（全已读，unread 0）', async () => {
      await svc.markRead(sup, 'p1', 'public', 'M-ghost');
      const call = prismaMock.openingHallReadCursor.upsert.mock.calls[0][0];
      expect(call.update.lastReadAt).toBeInstanceOf(Date);
      expect(call.update.lastReadAt.getTime()).toBeGreaterThan(t3.getTime()); // now() 晚于全部消息
      expect((await svc.unreadCounts(sup, 'p1')).public).toBe(0);
    });

    it('跨项目乱报 id（findFirst 未命中）→ 回退 now()，不用来路不明消息的 createdAt', async () => {
      prismaMock.openingHallMessage.findFirst.mockResolvedValue(null); // 模拟 id 属于别的项目/会话
      await svc.markRead(sup, 'p1', 'public', 'M1');
      const call = prismaMock.openingHallReadCursor.upsert.mock.calls[0][0];
      expect(call.update.lastReadAt.getTime()).toBeGreaterThan(t3.getTime());
    });

    it('向后兼容：不传 lastMessageId（旧前端）仍走 now()', async () => {
      await svc.markRead(sup, 'p1', 'public');
      expect(prismaMock.openingHallMessage.findFirst).not.toHaveBeenCalled();
      const call = prismaMock.openingHallReadCursor.upsert.mock.calls[0][0];
      expect(call.update.lastReadAt.getTime()).toBeGreaterThan(t3.getTime());
    });
  });

  describe('checkIn 原子抢占（R6：并发双签到不重复留痕、签到与监督日志同事务）', () => {
    it('首签：updateMany({ checkInAt: null }) 抢占 + 同事务写监督日志', async () => {
      const res = await svc.checkIn(sup, 'p1', { ip: '1.2.3.4', ua: 'test' });
      expect(res.already).toBe(false);
      expect(prismaMock.$transaction).toHaveBeenCalled();
      expect(prismaMock.bidSupplier.updateMany).toHaveBeenCalledWith({
        where: { id: 'bs1', checkInAt: null }, // 原子抢占：仅首签命中
        data: expect.objectContaining({ checkInAt: expect.any(Date) }),
      });
      expect(prismaMock.bidSupervisionLog.create).toHaveBeenCalled();
      expect(gatewayMock.notifyHallCheckin).toHaveBeenCalled();
    });

    it('并发第二签到（抢占 count=0）→ already:true、不重复写监督日志、不广播', async () => {
      const t = new Date('2026-07-24T09:00:00Z');
      prismaMock.bidSupplier.updateMany.mockResolvedValue({ count: 0 }); // 另一请求已抢占
      prismaMock.bidSupplier.findUnique.mockResolvedValue({ checkInAt: t });
      const res = await svc.checkIn(sup, 'p1', { ip: '1.2.3.4', ua: 'test' });
      expect(res.already).toBe(true);
      expect(res.checkInAt.toISOString()).toBe(t.toISOString()); // 回读首签时间
      expect(prismaMock.bidSupervisionLog.create).not.toHaveBeenCalled(); // 无重复留痕
      expect(gatewayMock.notifyHallCheckin).not.toHaveBeenCalled();
    });
  });
});
