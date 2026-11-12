import { Test } from '@nestjs/testing';
import { BidIntentOversightService } from './bid-intent-oversight.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';

describe('BidIntentOversightService（2026-11-12 履约闭环）', () => {
  let service: BidIntentOversightService;
  let prisma: any;
  let notify: any;

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      bidProject: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      supplierBidIntent: { findMany: jest.fn().mockResolvedValue([]) },
      invitationRsvp: { findMany: jest.fn().mockResolvedValue([]) },
      supplierBidSubmission: { findMany: jest.fn().mockResolvedValue([]) },
      supplierBidNoShow: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), count: jest.fn().mockResolvedValue(0), findFirst: jest.fn() },
      supplier: { findUnique: jest.fn(), updateMany: jest.fn() },
      user: { update: jest.fn().mockResolvedValue({}) },
      supplierPenalty: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    };
    notify = { sendToUser: jest.fn().mockResolvedValue({}) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        BidIntentOversightService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: notify },
      ],
    }).compile();
    service = moduleRef.get(BidIntentOversightService);
    jest.spyOn(service, 'resolveDeployRef').mockResolvedValue(new Date('2026-11-12T00:00:00Z'));
  });

  const proj = (over: any = {}) => ({ id: 'p1', projectManagementItemId: null, stage: 'OPENING', ...over });

  it('INTENT 轨：OPENING 后意向未投递→写事故 legacy 按承诺时间判定', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(proj());
    prisma.supplierBidIntent.findMany.mockResolvedValue([{ supplierId: 's1', confirmedAt: new Date('2026-11-13T00:00:00Z') }]);
    prisma.invitationRsvp.findMany.mockResolvedValue([]);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([]);
    prisma.supplierBidNoShow.create.mockResolvedValue({ id: 'n1' });
    prisma.supplierBidNoShow.count.mockResolvedValue(1); // 不足 3，不触发拉黑
    const r = await service.sweepProject('p1');
    expect(r.created).toBe(1);
    expect(prisma.supplierBidNoShow.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ projectId: 'p1', supplierId: 's1', track: 'INTENT', legacy: false }),
    }));
    expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
  });

  it('已投递不写事故；withdrawn 视同未投递写事故', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(proj());
    prisma.supplierBidIntent.findMany.mockResolvedValue([{ supplierId: 's1', confirmedAt: new Date('2026-11-13T00:00:00Z') }]);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([{ supplierId: 's1', status: 'submitted' }]);
    expect((await service.sweepProject('p1')).created).toBe(0);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([{ supplierId: 's1', status: 'withdrawn' }]);
    prisma.supplierBidNoShow.count.mockResolvedValue(0);
    expect((await service.sweepProject('p1')).created).toBe(1);
  });

  it('RSVP 轨：多批次取 respondedAt 最新一条，ACCEPTED 计、代变更 DECLINED 不计；双 id 命中', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(proj({ projectManagementItemId: 'pmi1' }));
    prisma.supplierBidIntent.findMany.mockResolvedValue([]);
    prisma.invitationRsvp.findMany.mockResolvedValue([
      { supplierId: 's1', projectId: 'p1', status: 'ACCEPTED', respondedAt: new Date('2026-11-01T00:00:00Z') },
      { supplierId: 's1', projectId: 'pmi1', status: 'DECLINED', respondedAt: new Date('2026-11-03T00:00:00Z') }, // 最新=婉拒→不计
    ]);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([]);
    expect((await service.sweepProject('p1')).created).toBe(0);
    prisma.invitationRsvp.findMany.mockResolvedValue([
      { supplierId: 's1', projectId: 'pmi1', status: 'ACCEPTED', respondedAt: new Date('2026-11-03T00:00:00Z') },
    ]);
    prisma.supplierBidNoShow.count.mockResolvedValue(0);
    expect((await service.sweepProject('p1')).created).toBe(1);
    expect(prisma.invitationRsvp.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ projectId: { in: ['p1', 'pmi1'] } }),
    }));
  });

  it('ABORTED 不计数；已存在事故行幂等跳过', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(proj({ stage: 'ABORTED' }));
    expect((await service.sweepProject('p1')).created).toBe(0);
    prisma.bidProject.findUnique.mockResolvedValue(proj());
    prisma.supplierBidIntent.findMany.mockResolvedValue([{ supplierId: 's1', confirmedAt: new Date() }]);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([]);
    prisma.supplierBidNoShow.findUnique.mockResolvedValue({ id: 'exist' });
    expect((await service.sweepProject('p1')).created).toBe(0);
    expect(prisma.supplierBidNoShow.create).not.toHaveBeenCalled();
  });

  it('非 legacy 满 3 次触发自动拉黑：状态占用+账号停用+处罚留痕+通知（复用 SUPPLIER_BLACKLISTED）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(proj());
    prisma.supplierBidIntent.findMany.mockResolvedValue([{ supplierId: 's1', confirmedAt: new Date('2026-11-13T00:00:00Z') }]);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([]);
    prisma.supplierBidNoShow.findUnique.mockResolvedValue(null);
    prisma.supplierBidNoShow.create.mockResolvedValue({ id: 'n3' });
    prisma.supplierBidNoShow.count.mockResolvedValue(3);
    prisma.supplierBidNoShow.findMany.mockResolvedValue([
      { supplierId: 's1', legacy: false, detectedAt: new Date(), project: { name: 'A 项目', projectCode: 'BID-1' } },
      { supplierId: 's1', legacy: false, detectedAt: new Date(), project: { name: 'B 项目', projectCode: 'BID-2' } },
      { supplierId: 's1', legacy: false, detectedAt: new Date(), project: { name: 'C 项目', projectCode: 'BID-3' } },
    ]);
    prisma.supplier.findUnique.mockResolvedValue({ id: 's1', name: '蜀通', status: 'APPROVED', userId: 'u1' });
    prisma.supplier.updateMany.mockResolvedValue({ count: 1 });
    await service.sweepProject('p1');
    expect(prisma.supplier.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'BLACKLIST' }),
    }));
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { isActive: false } });
    expect(prisma.supplierPenalty.create).toHaveBeenCalled();
    expect(notify.sendToUser).toHaveBeenCalledWith('u1', ['in_app'], expect.objectContaining({ type: 'SUPPLIER_BLACKLISTED' }));
  });

  it('legacy 事故不计触发（2 legacy+1 新=1 非 legacy，不拉黑）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(proj());
    prisma.supplierBidIntent.findMany.mockResolvedValue([{ supplierId: 's1', confirmedAt: new Date('2026-11-01T00:00:00Z') }]); // 早于 deployRef→legacy
    prisma.supplierBidSubmission.findMany.mockResolvedValue([]);
    prisma.supplierBidNoShow.findUnique.mockResolvedValue(null);
    prisma.supplierBidNoShow.create.mockResolvedValue({ id: 'n1' });
    prisma.supplierBidNoShow.count.mockResolvedValue(3); // 总 3（含 legacy）
    await service.sweepProject('p1');
    expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
  });

  it('已在黑名单/待审核态跳过拉黑不抛错（cron 不得死）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(proj());
    prisma.supplierBidIntent.findMany.mockResolvedValue([{ supplierId: 's1', confirmedAt: new Date('2026-11-13T00:00:00Z') }]);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([]);
    prisma.supplierBidNoShow.findUnique.mockResolvedValue(null);
    prisma.supplierBidNoShow.create.mockResolvedValue({ id: 'n3' });
    prisma.supplierBidNoShow.count.mockResolvedValue(3);
    prisma.supplierBidNoShow.findMany.mockResolvedValue([{ supplierId: 's1', legacy: false, detectedAt: new Date(), project: { name: 'A', projectCode: 'BID-1' } }]);
    prisma.supplier.findUnique.mockResolvedValue({ id: 's1', name: '蜀通', status: 'BLACKLIST', userId: 'u1' });
    await expect(service.sweepProject('p1')).resolves.toBeTruthy();
    expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
  });

  it('getParticipation KPI 聚合与 blacklist 视图', async () => {
    prisma.supplierBidIntent.findMany.mockResolvedValue([{ supplierId: 's1', confirmedAt: new Date(), project: { id: 'p1', name: 'A', projectCode: 'BID-1', stage: 'ARCHIVED' } }]);
    prisma.invitationRsvp.findMany.mockResolvedValue([{ projectId: 'p2', respondedAt: new Date() }]);
    prisma.supplierBidSubmission.findMany.mockResolvedValue([{ projectId: 'p1', submittedAt: new Date() }]);
    prisma.supplierBidNoShow.findMany.mockResolvedValue([{ legacy: true, detectedAt: new Date(), track: 'RSVP', project: { name: 'B', projectCode: 'BID-2', stage: 'ARCHIVED' } }]);
    prisma.supplier.findUnique.mockResolvedValue({ status: 'BLACKLIST', disableReason: '测试' });
    prisma.supplierPenalty.findMany.mockResolvedValue([{ penaltyDocNo: 'AUTO-1', authority: '采购中心', decisionDate: new Date(), penaltyContent: 'x' }]);
    const r = await service.getParticipation('s1');
    expect(r.kpi).toMatchObject({ intentTotal: 1, rsvpAcceptedTotal: 1, submittedTotal: 1, noShowTotal: 1, noShowActiveCount: 0 });
    expect(r.intents[0].submitted).toBe(true);
    expect(r.blacklist?.reason).toBe('测试');
  });
});
