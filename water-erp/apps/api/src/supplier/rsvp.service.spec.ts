import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RsvpService } from './rsvp.service';

/** P0-1 回执 respond() 单测：BidProject 解析（双 id 空间：BidProject 主键 / PMI 反查）+ 同事务 + 半成功防护。
 *  （projectId 口径：2026-10-16 起生成端规范化为 BidProject id；旧轨行仍是 PMI id——respond 兼容两者。）
 *  2026-10-21 回执一次性锁定：respondedAt 非空 → 409 RSVP_ALREADY_RESPONDED（供应商不可自行变更）。 */
describe('RsvpService.respond（P0-1 + 一次性锁定）', () => {
  let service: RsvpService;
  let prisma: any;
  let notification: any;
  const futureDate = new Date(Date.now() + 3600_000);
  const baseRow = {
    id: 'rsvp1', token: 't1', projectId: 'PMI-ID', supplierId: 's1',
    supplierName: '供应商A', status: 'PENDING', expiresAt: futureDate, respondedAt: null as Date | null,
  };

  beforeEach(() => {
    prisma = {
      invitationRsvp: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({ id: 'rsvp1', status: 'ACCEPTED', respondedAt: new Date() }) },
      invitationRsvpLog: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
      bidProject: { findFirst: jest.fn(), findUnique: jest.fn().mockResolvedValue(null) },
      bidSupplier: { upsert: jest.fn().mockResolvedValue({}) },
      supplier: { findUnique: jest.fn().mockResolvedValue({ userId: 'u-supplier' }) },
      $transaction: jest.fn().mockImplementation(async (fn: any) => fn(prisma)),
    };
    notification = { resolveByLinkToken: jest.fn().mockResolvedValue({ count: 1 }), create: jest.fn().mockResolvedValue({}) };
    service = new RsvpService(prisma, { ensureBidProject: jest.fn().mockResolvedValue({}) } as any, notification as any);
  });

  it('ACCEPTED：projectId 已是规范 BidProject id（生成端 2026-10-16 起规范化）→ 主键直接命中，不再当 PMI id 反查', async () => {
    prisma.invitationRsvp.findUnique.mockResolvedValue({ ...baseRow, projectId: 'BP-CANON' });
    prisma.bidProject.findUnique.mockResolvedValue({ id: 'BP-CANON' });

    const r = await service.respond('t1', { status: 'ACCEPTED' });

    expect(r.success).toBe(true);
    expect(prisma.bidProject.findFirst).not.toHaveBeenCalled();
    expect(prisma.bidSupplier.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId_supplierName: { projectId: 'BP-CANON', supplierName: '供应商A' } },
        create: expect.objectContaining({ projectId: 'BP-CANON', supplierId: 's1' }),
      }),
    );
  });

  it('ACCEPTED（旧轨）：projectId 是 PMI id → 主键落空后按 projectManagementItemId 反查再 upsert', async () => {
    prisma.invitationRsvp.findUnique.mockResolvedValue(baseRow);
    prisma.bidProject.findFirst.mockResolvedValue({ id: 'BP-1' });

    const r = await service.respond('t1', { status: 'ACCEPTED' });

    expect(r.success).toBe(true);
    expect(prisma.bidProject.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectManagementItemId: 'PMI-ID' } }),
    );
    expect(prisma.bidSupplier.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId_supplierName: { projectId: 'BP-1', supplierName: '供应商A' } },
        create: expect.objectContaining({ projectId: 'BP-1', supplierId: 's1' }),
      }),
    );
  });

  it('ACCEPTED 但 BidProject 尚未懒创建：回执仍成功，不 upsert 不抛错', async () => {
    prisma.invitationRsvp.findUnique.mockResolvedValue(baseRow);
    prisma.bidProject.findFirst.mockResolvedValue(null);

    const r = await service.respond('t1', { status: 'ACCEPTED' });

    expect(r.success).toBe(true);
    expect(prisma.bidSupplier.upsert).not.toHaveBeenCalled();
  });

  it('回执状态更新、候选 upsert、轨迹留痕在同一事务内（防半成功 + 审计断链）', async () => {
    prisma.invitationRsvp.findUnique.mockResolvedValue(baseRow);
    prisma.bidProject.findFirst.mockResolvedValue({ id: 'BP-1' });

    await service.respond('t1', { status: 'ACCEPTED' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // 写操作都应经 tx（mock 中 tx===prisma，断言三者都被调用即证明进了事务回调）
    expect(prisma.invitationRsvp.update).toHaveBeenCalled();
    expect(prisma.bidSupplier.upsert).toHaveBeenCalled();
    expect(prisma.invitationRsvpLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rsvpId: 'rsvp1', action: 'RESPONDED', actorType: 'SUPPLIER',
          fromStatus: 'PENDING', toStatus: 'ACCEPTED',
        }),
      }),
    );
    // 作答方落 SUPPLIER（区别于 STAFF 代回应 / SYSTEM 超时弃权）
    expect(prisma.invitationRsvp.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ respondentType: 'SUPPLIER' }) }),
    );
  });

  it('DECLINED：只更新回执状态，不动候选名单', async () => {
    prisma.invitationRsvp.findUnique.mockResolvedValue(baseRow);

    await service.respond('t1', { status: 'DECLINED' });

    expect(prisma.bidSupplier.upsert).not.toHaveBeenCalled();
  });

  it('一次性锁定（2026-10-21）：已回执（respondedAt 非空）再提交 → 409 RSVP_ALREADY_RESPONDED，不落任何写', async () => {
    prisma.invitationRsvp.findUnique.mockResolvedValue({ ...baseRow, status: 'ACCEPTED', respondedAt: new Date() });

    await expect(service.respond('t1', { status: 'DECLINED' })).rejects.toMatchObject({
      response: { code: 'RSVP_ALREADY_RESPONDED' },
    });
    expect(prisma.invitationRsvp.update).not.toHaveBeenCalled();
    expect(prisma.invitationRsvpLog.create).not.toHaveBeenCalled();
  });

  it('回执后邀请待办消音（2026-10-14）：按供应商账号 + token 圈定 SELECTION_NOTIFY 置 resolvedAt；消音失败不阻断回执', async () => {
    prisma.invitationRsvp.findUnique.mockResolvedValue(baseRow);

    await service.respond('t1', { status: 'DECLINED' });

    expect(prisma.supplier.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1' }, select: { userId: true } }),
    );
    expect(notification.resolveByLinkToken).toHaveBeenCalledWith('u-supplier', 'SELECTION_NOTIFY', 't1');

    // 消音抛错 → 回执仍成功（仅 warn 日志）
    notification.resolveByLinkToken.mockRejectedValue(new Error('db down'));
    const r = await service.respond('t1', { status: 'DECLINED' });
    expect(r.success).toBe(true);
  });

  it('不存在/过期的 token 语义保留', async () => {
    prisma.invitationRsvp.findUnique.mockResolvedValue(null);
    await expect(service.respond('bad', { status: 'ACCEPTED' })).rejects.toBeInstanceOf(NotFoundException);

    prisma.invitationRsvp.findUnique.mockResolvedValue({ ...baseRow, expiresAt: new Date(Date.now() - 1000) });
    await expect(service.respond('t1', { status: 'ACCEPTED' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

/** manualMark（2026-10-21 重设计：代回应/代变更）：理由必填、同态幂等、轨迹留痕、
 *  确认→拒绝联动通知供应商（RSVP_OVERRIDDEN）与经历记录。 */
describe('RsvpService.manualMark（代回应/代变更）', () => {
  let service: RsvpService;
  let prisma: any;
  let notification: any;
  const futureDate = new Date(Date.now() + 3600_000);

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ displayName: '王工作' }) },
      bidProject: { findFirst: jest.fn().mockResolvedValue({ id: 'BP-1' }) },
      invitationRsvp: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'rsvp1', supplierId: 's1', supplierName: '供应商A', projectId: 'BP-1',
          title: '某采购邀请', status: 'ACCEPTED', respondedAt: new Date(), expiresAt: futureDate,
        }),
        update: jest.fn().mockResolvedValue({ id: 'rsvp1', status: 'DECLINED' }),
        create: jest.fn(),
      },
      invitationRsvpLog: { create: jest.fn().mockResolvedValue({}) },
      supplier: { findUnique: jest.fn().mockResolvedValue({ userId: 'u-supplier', name: '供应商A' }) },
    };
    notification = { resolveByLinkToken: jest.fn(), create: jest.fn().mockResolvedValue({}) };
    service = new RsvpService(prisma, {} as any, notification as any);
  });

  it('理由必填：少于 5 字 → 400 REASON_REQUIRED，不落任何写', async () => {
    await expect(service.manualMark({ projectId: 'PMI-1', supplierId: 's1', status: 'DECLINED', actorId: 'u1', reason: '太短' }))
      .rejects.toMatchObject({ response: { code: 'REASON_REQUIRED' } });
    expect(prisma.invitationRsvp.update).not.toHaveBeenCalled();
  });

  it('不再支持重置为待回执（审计链干净）：PENDING → 400 BAD_INPUT', async () => {
    await expect(service.manualMark({ projectId: 'PMI-1', supplierId: 's1', status: 'PENDING' as never, actorId: 'u1', reason: '重置试试看' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('同状态重复标记幂等：changed=false，不写轨迹不发通知', async () => {
    const r = await service.manualMark({ projectId: 'PMI-1', supplierId: 's1', status: 'ACCEPTED', actorId: 'u1', reason: '电话核实确认参加' });
    expect(r).toEqual({ id: 'rsvp1', status: 'ACCEPTED', changed: false });
    expect(prisma.invitationRsvp.update).not.toHaveBeenCalled();
    expect(prisma.invitationRsvpLog.create).not.toHaveBeenCalled();
  });

  it('确认→拒绝：更新作答方四列 + 轨迹 STAFF_MARKED（from/to/reason）+ 通知供应商本人', async () => {
    const r = await service.manualMark({ projectId: 'PMI-1', supplierId: 's1', status: 'DECLINED', actorId: 'u1', reason: '核实资质不符，取消邀请' });
    expect(r.changed).toBe(true);
    expect(prisma.invitationRsvp.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rsvp1' },
        data: expect.objectContaining({
          status: 'DECLINED', respondentType: 'STAFF', respondedById: 'u1',
          respondedByName: '王工作', staffReason: '核实资质不符，取消邀请',
        }),
      }),
    );
    expect(prisma.invitationRsvpLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'STAFF_MARKED', actorType: 'STAFF', actorName: '王工作',
          fromStatus: 'ACCEPTED', toStatus: 'DECLINED', reason: '核实资质不符，取消邀请',
        }),
      }),
    );
    expect(notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-supplier',
        type: 'RSVP_OVERRIDDEN',
        content: expect.stringContaining('确认参加 → 无法参加'),
      }),
    );
  });

  it('通知发送失败不阻断代变更主流程', async () => {
    notification.create.mockRejectedValue(new Error('notify down'));
    const r = await service.manualMark({ projectId: 'PMI-1', supplierId: 's1', status: 'DECLINED', actorId: 'u1', reason: '核实资质不符，取消邀请' });
    expect(r.changed).toBe(true);
  });

  it('无回执行：补 manual 行（作答方 STAFF + 理由落列）+ 轨迹留痕', async () => {
    prisma.invitationRsvp.findFirst.mockResolvedValue(null);
    prisma.invitationRsvp.create.mockResolvedValue({ id: 'rsvp-new', status: 'ACCEPTED' });
    const r = await service.manualMark({ projectId: 'PMI-1', supplierId: 's1', status: 'ACCEPTED', actorId: 'u1', reason: '电话核实确认参加' });
    expect(r).toEqual({ id: 'rsvp-new', status: 'ACCEPTED', changed: true });
    expect(prisma.invitationRsvp.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ respondentType: 'STAFF', respondedByName: '王工作', staffReason: '电话核实确认参加' }),
      }),
    );
    expect(prisma.invitationRsvpLog.create).toHaveBeenCalled();
  });
});

/** markNotified（2026-10-20 用户口径）：一键通知点击时刻打戳——时间轴「供应商邀请」数据源。
 *  仅补空（notifiedAt null）不覆盖；双 id 空间双向兜底（BidProject 主键 / PMI 反查）。 */
describe('RsvpService.markNotified（邀请发送打戳）', () => {
  let service: RsvpService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      invitationRsvp: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      bidProject: { findFirst: jest.fn(), findUnique: jest.fn().mockResolvedValue(null) },
    };
    service = new RsvpService(prisma, {} as any, {} as any);
  });

  it('传入 BidProject id：双向兜底出双 id 空间，仅对未打戳行写入', async () => {
    prisma.bidProject.findUnique.mockResolvedValue({ projectManagementItemId: 'PMI-1' }); // 传的是 BP id
    const r = await service.markNotified('BP-1', ['s1', 's2']);
    expect(r).toEqual({ stamped: 2 });
    expect(prisma.invitationRsvp.updateMany).toHaveBeenCalledWith({
      where: { supplierId: { in: ['s1', 's2'] }, projectId: { in: ['BP-1', 'PMI-1'] }, notifiedAt: null },
      data: { notifiedAt: expect.any(Date) },
    });
  });

  it('传入 PMI id：按 projectManagementItemId 反查 BidProject id 并入空间', async () => {
    prisma.bidProject.findFirst.mockResolvedValue({ id: 'BP-1' }); // PMI→BP 反查命中
    await service.markNotified('PMI-1', ['s1']);
    expect(prisma.invitationRsvp.updateMany).toHaveBeenCalledWith({
      where: { supplierId: { in: ['s1'] }, projectId: { in: ['PMI-1', 'BP-1'] }, notifiedAt: null },
      data: { notifiedAt: expect.any(Date) },
    });
  });

  it('参数缺失 → BAD_INPUT', async () => {
    await expect(service.markNotified('', ['s1'])).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.markNotified('BP-1', [])).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.invitationRsvp.updateMany).not.toHaveBeenCalled();
  });
});
