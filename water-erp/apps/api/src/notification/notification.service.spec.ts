import { Test, TestingModule } from '@nestjs/testing';
import { NotificationService } from './notification.service';
import { EmailChannel } from './channels/email.channel';
import { SmsChannel } from './channels/sms.channel';
import { PhoneChannel } from './channels/phone.channel';
import { PrismaService } from '../prisma/prisma.service';

describe('NotificationService', () => {
  let service: NotificationService;
  const prisma = {
    notification: {
      count: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    notificationDeliveryLog: { create: jest.fn().mockResolvedValue({}) },
    user: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
  };
  const emailChannel = { send: jest.fn().mockResolvedValue({ status: 'skipped' }) } as any;
  const smsChannel = { send: jest.fn().mockResolvedValue({ status: 'skipped' }) } as any;
  const phoneChannel = { send: jest.fn().mockResolvedValue({ status: 'skipped' }) } as any;

  beforeEach(async () => {
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: EmailChannel, useValue: emailChannel },
        { provide: SmsChannel, useValue: smsChannel },
        { provide: PhoneChannel, useValue: phoneChannel },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = mod.get(NotificationService);
  });

  it('sendToUser 供应商短信逐联系人各发一条（2026-10-27）：多联系人多次投递+逐条留痕+聚合 sent', async () => {
    smsChannel.send.mockReset().mockResolvedValue({ status: 'sent' });
    (prisma.notification.create as jest.Mock).mockResolvedValue({ id: 'n1' });
    jest.spyOn(service as any, 'pushRealtime').mockImplementation(() => {});
    // resolvePhones 已按联系人拆封去重排序（其行为由独立用例锁），此处直接注入结果：3 联系人含 1 重复号 → 2 号码
    jest.spyOn(service as any, 'resolvePhones').mockResolvedValue(['13800000001', '13800000002']);

    const r = await service.sendToUser('u1', ['in_app', 'sms'], { type: 'SELECTION_NOTIFY', title: 't', content: 'c' });

    expect(smsChannel.send).toHaveBeenCalledTimes(2);
    expect((smsChannel.send as jest.Mock).mock.calls.map(c => c[0].phone)).toEqual(['13800000001', '13800000002']);
    expect(prisma.notificationDeliveryLog.create).toHaveBeenCalledTimes(3); // in_app 1 + sms 2
    expect(r.results.sms).toBe('sent');
  });

  it('sendToUser 无联系人仅发站内：短信零投递 + 留痕一条 skipped（2026-10-27 用户口径）', async () => {
    jest.spyOn(service as any, 'resolvePhones').mockResolvedValue([]);
    smsChannel.send.mockReset();
    (prisma.notification.create as jest.Mock).mockResolvedValue({ id: 'n2' });
    jest.spyOn(service as any, 'pushRealtime').mockImplementation(() => {});

    const r = await service.sendToUser('u2', ['in_app', 'sms'], { type: 'SELECTION_NOTIFY', title: 't', content: 'c' });

    expect(smsChannel.send).not.toHaveBeenCalled();
    const logs = (prisma.notificationDeliveryLog.create as jest.Mock).mock.calls.map(c => c[0].data);
    expect(logs).toContainEqual(expect.objectContaining({ channel: 'sms', status: 'skipped' }));
    expect(r.results.sms).toBe('skipped');
  });

  it('create() 站内通知不再隐式外发短信（2026-11-05 裁定）：有联系人手机号也零短信，phone 渠道不受影响', async () => {
    smsChannel.send.mockReset();
    phoneChannel.send.mockReset().mockResolvedValue({ status: 'sent' });
    // 本文件 mock 跨用例累积（无 clearAllMocks），投递日志先清零只看本用例记录
    (prisma.notificationDeliveryLog.create as jest.Mock).mockClear();
    (prisma.notification.create as jest.Mock).mockResolvedValue({ id: 'n3' });
    jest.spyOn(service as any, 'pushRealtime').mockImplementation(() => {});
    jest.spyOn(service as any, 'resolvePhones').mockResolvedValue(['13800000001']);

    await service.create({ userId: 'u3', type: 'SELECTION_NOTIFY', title: 't', content: 'c' });
    // dispatchExternal 是 void 异步外发（失败不阻断），冲刷微任务后再断言
    await new Promise(r => setImmediate(r));

    // 手机号存在也不发短信——隐式短信层已删（此前 create() 会全联系人各发一条）
    expect(smsChannel.send).not.toHaveBeenCalled();
    // phone 渠道保留：有主联系人电话仍外发
    expect(phoneChannel.send).toHaveBeenCalledTimes(1);
    const logs = (prisma.notificationDeliveryLog.create as jest.Mock).mock.calls.map(c => c[0].data);
    expect(logs).toContainEqual(expect.objectContaining({ channel: 'in_app', status: 'sent' }));
    expect(logs).not.toContainEqual(expect.objectContaining({ channel: 'sms' }));
  });

  it('list tab=todo 只返回未 resolve 的通知（where 含 resolvedAt: null）', async () => {
    prisma.notification.count.mockResolvedValue(1);
    prisma.notification.findMany.mockResolvedValue([{ id: 'n1' }]);
    const res = await service.list('u1', 1, 20, 'todo');
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ userId: 'u1', resolvedAt: null }),
    });
    expect(res.total).toBe(1);
  });

  it('list tab=all 不加 resolvedAt 过滤', async () => {
    prisma.notification.count.mockResolvedValue(5);
    prisma.notification.findMany.mockResolvedValue([]);
    await service.list('u1', 1, 20, 'all');
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { userId: 'u1' },
    });
  });

  it('list 将消息类型过滤同时用于 count 与 findMany', async () => {
    prisma.notification.count.mockResolvedValue(2);
    prisma.notification.findMany.mockResolvedValue([]);

    await service.list('u1', 2, 15, 'todo', ['AWARD_LETTER', 'CONTRACT_NOTICE']);

    const where = {
      userId: 'u1',
      resolvedAt: null,
      isRead: false, // 919d5391：待办口径=未读且未 resolve（已读即视为已知晓）
      type: { in: ['AWARD_LETTER', 'CONTRACT_NOTICE'] },
    };
    expect(prisma.notification.count).toHaveBeenCalledWith({ where });
    expect(prisma.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({ where, skip: 15, take: 15 }));
  });

  it('list typeCounts 按 countTypes 基底分组（不受单类型筛选影响）', async () => {
    prisma.notification.count.mockResolvedValue(3);
    prisma.notification.findMany.mockResolvedValue([]);
    prisma.notification.groupBy.mockResolvedValue([
      { type: 'ARCHIVE_READY', _count: { type: 10 } },
      { type: 'EXPERT_RETIRE_CANDIDATE', _count: { type: 5 } },
    ]);

    const res = await service.list('u1', 1, 20, 'todo', ['ARCHIVE_READY'], ['ARCHIVE_READY', 'EXPERT_RETIRE_CANDIDATE']);

    // 列表 where 按单类型筛选
    expect(prisma.notification.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ type: { in: ['ARCHIVE_READY'] } }),
    }));
    // 计数 where 用域基底，且不与列表 where 串扰
    expect(prisma.notification.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ type: { in: ['ARCHIVE_READY', 'EXPERT_RETIRE_CANDIDATE'] } }),
    }));
    // 输出按计数降序、扁平化
    expect(res.typeCounts).toEqual([
      { type: 'ARCHIVE_READY', count: 10 },
      { type: 'EXPERT_RETIRE_CANDIDATE', count: 5 },
    ]);
  });

  it('resolveActionable 按 type+link 写 resolvedAt', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    await service.resolveActionable('SUPPLIER_PENDING', '/supplier/s1');
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { type: 'SUPPLIER_PENDING', link: '/supplier/s1', resolvedAt: null },
      data: { resolvedAt: expect.any(Date) },
    });
  });

  it('resolveActionableBySupplierName 按供应商名过滤（广播待办不牵连并行在审者），空名不动', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    await service.resolveActionableBySupplierName(
      'SUPPLIER_CHANGE_PENDING', '/supplier?tab=changes', '甲公司',
    );
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: {
        type: 'SUPPLIER_CHANGE_PENDING',
        link: '/supplier?tab=changes',
        resolvedAt: null,
        content: { contains: '甲公司' },
      },
      data: { resolvedAt: expect.any(Date) },
    });
    // 空名（供应商查不到）→ 宁留勿杀，零调用
    prisma.notification.updateMany.mockClear();
    await service.resolveActionableBySupplierName('SUPPLIER_CHANGE_PENDING', '/supplier?tab=changes', '  ');
    expect(prisma.notification.updateMany).not.toHaveBeenCalled();
  });

  it('resolveActionableForUser 仅处理指定用户和业务关联链接的通知', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });

    await service.resolveActionableForUser(
      'user-1', 'AWARD_LETTER', '/award-letters?deliveryId=delivery-1',
    );

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        type: 'AWARD_LETTER',
        link: '/award-letters?deliveryId=delivery-1',
        resolvedAt: null,
      },
      data: { resolvedAt: expect.any(Date) },
    });
  });

  it('sendToCompanyRoles：本公司角色定向，无归属/无人兜底 admin（2026-11-02 跨公司错发系统修复）', async () => {
    prisma.user.findMany.mockImplementation(async ({ where }: any) => {
      if (where.companyId === 'co-x') return [{ id: 'u-x1' }, { id: 'u-x2' }];
      if (where.role === 'admin') return [{ id: 'u-admin' }];
      return [];
    });
    prisma.notification.create.mockClear().mockResolvedValue({});
    // 与本文件其余 sendToUser 用例同款：resolvePhones 真身查未 mock 的联系人表会炸（allSettled 吞掉 → sent 虚高、create 零调用）
    jest.spyOn(service as any, 'resolvePhones').mockResolvedValue([]);
    jest.spyOn(service as any, 'pushRealtime').mockImplementation(() => {});

    const r1 = await service.sendToCompanyRoles('co-x', ['leader', 'staff'], { type: 'T', title: 't', content: 'c', link: '/x' });
    expect(r1).toEqual({ sent: 2, fallbackAdmin: false });
    expect(prisma.notification.create).toHaveBeenCalledTimes(2);
    expect(prisma.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'u-x1', type: 'T' }) });

    prisma.notification.create.mockClear();
    const r2 = await service.sendToCompanyRoles(null, ['leader'], { type: 'T', title: 't', content: 'c' });
    expect(r2).toEqual({ sent: 1, fallbackAdmin: true });
    expect(prisma.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'u-admin' }) });
  });

  it('resolveOwn 办结自己的待办：resolvedAt+isRead+readAt 一次落库（2026-11-04 处理窗「标记已办」真实路径）', async () => {
    prisma.notification.findUnique.mockReset().mockResolvedValue({
      id: 'n1', userId: 'u1', type: 'EXPERT_DECLINE_STREAK', resolvedAt: null, isRead: false,
    });
    prisma.notification.update.mockClear().mockResolvedValue({ id: 'n1', resolvedAt: new Date() });

    await service.resolveOwn('n1', 'u1');

    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { resolvedAt: expect.any(Date), isRead: true, readAt: expect.any(Date) },
    });
  });

  it('resolveOwn 群发复核型（连拒预警）整组消解：任一收件人办结，同 type+link+content 的群发副本一并办结（2026-11-12 实录：02 办结后 01 仍挂待办）', async () => {
    const content = '专家「朱少帅」已连续 3 次拒绝评审邀请（含婉拒/超时弃权/代婉拒），请复核其参评意愿与库内状态。';
    prisma.notification.findUnique.mockReset().mockResolvedValue({
      id: 'n1', userId: 'u1', type: 'EXPERT_DECLINE_STREAK', resolvedAt: null, isRead: false,
      link: '/expert/e1?tab=overview', content,
    });
    prisma.notification.update.mockClear().mockResolvedValue({ id: 'n1' });
    prisma.notification.updateMany.mockClear().mockResolvedValue({ count: 9 });

    await service.resolveOwn('n1', 'u1');

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { type: 'EXPERT_DECLINE_STREAK', link: '/expert/e1?tab=overview', content, resolvedAt: null },
      data: { resolvedAt: expect.any(Date), isRead: true, readAt: expect.any(Date) },
    });
  });

  it('resolveOwn 非群发复核型不整组消解：个人待办办结只动本人行', async () => {
    prisma.notification.findUnique.mockReset().mockResolvedValue({
      id: 'n2', userId: 'u1', type: 'SUPPLIER_PENDING', resolvedAt: null, isRead: false,
      link: '/supplier/approval?supplierId=s1', content: 'x',
    });
    prisma.notification.update.mockClear().mockResolvedValue({ id: 'n2' });
    prisma.notification.updateMany.mockClear();

    await service.resolveOwn('n2', 'u1');

    expect(prisma.notification.updateMany).not.toHaveBeenCalled();
  });

  it('resolveOwn 幂等：已办结不重置时间、不落库', async () => {
    const done = { id: 'n2', userId: 'u1', type: 'SUPPLIER_PENDING', resolvedAt: new Date('2026-11-01'), isRead: false };
    prisma.notification.findUnique.mockReset().mockResolvedValue(done);
    prisma.notification.update.mockClear();

    await expect(service.resolveOwn('n2', 'u1')).resolves.toBe(done);
    expect(prisma.notification.update).not.toHaveBeenCalled();
  });

  it('resolveOwn 拒绝知会类与非本人通知', async () => {
    prisma.notification.update.mockClear();
    prisma.notification.findUnique.mockReset().mockResolvedValue(null);
    await expect(service.resolveOwn('n3', 'u1'))
      .rejects.toMatchObject({ status: 404 });
    prisma.notification.findUnique.mockResolvedValue({ id: 'n4', userId: 'u1', type: 'BID_OPENING_CONFIRMED', resolvedAt: null });
    await expect(service.resolveOwn('n4', 'u1'))
      .rejects.toMatchObject({ status: 400, response: expect.objectContaining({ code: 'NOT_ACTIONABLE' }) });
    prisma.notification.findUnique.mockResolvedValue({ id: 'n5', userId: 'u2', type: 'SUPPLIER_PENDING', resolvedAt: null });
    await expect(service.resolveOwn('n5', 'u1'))
      .rejects.toMatchObject({ status: 404 });
  });
});
