import { ProjectChangeService } from './change.service';

/** 变更登记服务（2026-11-11 spec §3/§4）：理由必填、白名单+阶段闸门、开标锁、
 *  空变更拒绝、轮次自增、diff 留痕、开标时间→needsAnnouncement+PMI 中文格式同步。 */

const PMI = {
  id: 'p1', title: '原名', procurementCategory: '货物', budgetAmount: 100, currentStage: 'INITIATION',
  requesterName: '李四', requesterDepartment: '勘察院', projectOverview: '概况',
  bidOpeningTime: '2026年11月15日 09:00',
  stages: [{ stageKey: 'PROCUREMENT_DEMAND' }, { stageKey: 'INITIATION' }, { stageKey: 'TENDER_DOCUMENT' }],
};
const BP = { id: 'bp1', round: 1, stage: 'SUBMIT', qualification: '旧资格', scope: '旧范围', qualityRequirement: '旧要求' };

const mk = (over: Record<string, any> = {}) => {
  const prisma: any = {
    projectManagementItem: {
      findUnique: jest.fn().mockResolvedValue(over.pmi ?? { ...PMI }),
      update: jest.fn().mockResolvedValue({}),
    },
    bidProject: {
      findFirst: jest.fn().mockResolvedValue(over.bp ?? { ...BP }),
      update: jest.fn().mockResolvedValue({}),
    },
    projectChangeRecord: {
      aggregate: jest.fn().mockResolvedValue({ _max: { round: over.maxRound ?? 0 } }),
      // 回显入参（type/round/changeset 随调用数据返回——断言的是服务传了什么）
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'cr1', ...data })),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };
  const pmiService: any = { syncBidProjectOpeningFromPmi: jest.fn().mockResolvedValue(undefined) };
  const svc = new ProjectChangeService(prisma, pmiService);
  return { prisma, pmiService, svc };
};

describe('ProjectChangeService.register', () => {
  it('理由空/纯空格 → 400 REASON_REQUIRED', async () => {
    const { svc } = mk();
    await expect(svc.register('p1', 'u1', '张三', { type: 'CHANGE', reason: '   ', fields: { title: '新名' } }))
      .rejects.toMatchObject({ response: { code: 'REASON_REQUIRED' } });
  });

  it('名单字段（biddingUnits）→ 400 FIELD_NOT_ALLOWED 且文案指向流程卡', async () => {
    const { svc } = mk();
    await expect(svc.register('p1', 'u1', '张三', { type: 'CHANGE', reason: 'r', fields: { biddingUnits: '甲、乙' } }))
      .rejects.toMatchObject({ response: { code: 'FIELD_NOT_ALLOWED', error: expect.stringContaining('供应商邀请') } });
  });

  it('白名单外字段 → 400 FIELD_NOT_ALLOWED', async () => {
    const { svc } = mk();
    await expect(svc.register('p1', 'u1', '张三', { type: 'CHANGE', reason: 'r', fields: { projectCode: 'X-1' } }))
      .rejects.toMatchObject({ response: { code: 'FIELD_NOT_ALLOWED' } });
  });

  it('阶段闸门：立项期改 notice 组字段（开标时间）→ 400 STAGE_LOCKED「未进入 采购文件 阶段」', async () => {
    const { svc } = mk();
    await expect(svc.register('p1', 'u1', '张三', { type: 'CHANGE', reason: 'r', fields: { bidOpeningTime: '2026-11-16T01:00:00.000Z' } }))
      .rejects.toMatchObject({ response: { code: 'STAGE_LOCKED', error: expect.stringContaining('公告与时间') } });
  });

  it('开标后（BidProject OPENING）→ 400 BID_LOCKED「开标后不可修改标前数据」', async () => {
    const { svc } = mk({ bp: { ...BP, stage: 'OPENING' } });
    await expect(svc.register('p1', 'u1', '张三', { type: 'CHANGE', reason: 'r', fields: { title: '新名' } }))
      .rejects.toMatchObject({ response: { code: 'BID_LOCKED', error: '开标后不可修改标前数据' } });
  });

  it('值无变化 → 400 NO_CHANGE（防空轮次）', async () => {
    const { svc } = mk();
    await expect(svc.register('p1', 'u1', '张三', { type: 'CHANGE', reason: 'r', fields: { title: '原名' } }))
      .rejects.toMatchObject({ response: { code: 'NO_CHANGE' } });
  });

  it('成功：轮次自增 + PMI 落库 + diff 留痕（label/from/to/stageKey）+ 操作人 displayName', async () => {
    const { prisma, svc } = mk({ maxRound: 2 });
    const r = await svc.register('p1', 'u1', '张三', { type: 'CHANGE', reason: '需求调整', fields: { title: '新名', budgetAmount: 200 } });
    expect(r.record.round).toBe(3);
    expect(prisma.projectManagementItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'p1' },
      data: expect.objectContaining({ title: '新名', budgetAmount: 200 }),
    }));
    const created = prisma.projectChangeRecord.create.mock.calls[0][0].data;
    expect(created.round).toBe(3);
    expect(created.reason).toBe('需求调整');
    expect(created.operatorName).toBe('张三');
    expect(created.changeset).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'title', label: '项目名称', from: '原名', to: '新名', stageKey: 'INITIATION' }),
      expect.objectContaining({ field: 'budgetAmount', label: '预算金额', from: '100', to: '200' }),
    ]));
    expect(r.needsAnnouncement).toBe(false);
  });

  it('开标时间变更：needsAnnouncement=true + PMI 中文格式(+08)写入 + 触发既有 sync（阶段=采购文件已到）', async () => {
    const { prisma, pmiService, svc } = mk({ pmi: { ...PMI, currentStage: 'TENDER_DOCUMENT' } });
    // 输入 ISO：2026-11-16T01:00:00Z = 北京 09:00
    const r = await svc.register('p1', 'u1', '张三', { type: 'CHANGE', reason: '延期', fields: { bidOpeningTime: '2026-11-16T01:00:00.000Z' } });
    expect(r.needsAnnouncement).toBe(true);
    expect(prisma.projectManagementItem.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ bidOpeningTime: '2026年11月16日 09:00' }),
    }));
    expect(pmiService.syncBidProjectOpeningFromPmi).toHaveBeenCalledWith('p1', '2026年11月16日 09:00');
  });

  it('采购文件域字段（资格要求等）→ 400 FIELD_NOT_ALLOWED（2026-11-11 用户裁定：变更范围=项目基本信息）', async () => {
    const { svc } = mk({ pmi: { ...PMI, currentStage: 'TENDER_DOCUMENT' } });
    await expect(svc.register('p1', 'u1', '张三', { type: 'CHANGE', reason: 'r', fields: { qualification: '新资格' } }))
      .rejects.toMatchObject({ response: { code: 'FIELD_NOT_ALLOWED' } });
  });

  it('ADDENDUM：仅留痕（fields 空、reason 必填），不写业务表', async () => {
    const { prisma, svc } = mk();
    const r = await svc.register('p1', 'u1', '张三', { type: 'ADDENDUM', reason: '补遗说明', fields: {} });
    expect(r.record.type).toBe('ADDENDUM');
    expect(prisma.projectManagementItem.update).not.toHaveBeenCalled();
    expect(prisma.bidProject.update).not.toHaveBeenCalled();
  });
});

describe('ProjectChangeService.list / bindAnnouncement', () => {
  it('list 按 round 倒序 take 100；bindAnnouncement 回填公告 id', async () => {
    const { prisma, svc } = mk();
    await svc.list('p1');
    expect(prisma.projectChangeRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectManagementItemId: 'p1' },
      orderBy: { round: 'desc' },
      take: 100,
    }));
    await svc.bindAnnouncement('cr1', 'ann-9');
    expect(prisma.projectChangeRecord.update).toHaveBeenCalledWith({
      where: { id: 'cr1' },
      data: { announcementId: 'ann-9' },
    });
  });
});
