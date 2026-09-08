import { BidOpeningRecordService } from './bid-opening-record.service';
import { WorkTemplateService } from './work-template.service';
import { WorkTemplateController } from './work-template.controller';
import { BidController } from './bid.controller';
import { DEFAULT_OPENING_FIELDS, type OpeningFieldDef } from './opening-field-config.util';

/**
 * A-113 唱标字段配置入口——端点组合层（真 service + 真 controller 分派 + mock prisma）：
 * PUT /bid/projects/:id/opening-field-config（fields 直给 / fromTemplateId 取模板）
 * 与 POST /work-templates/:id/apply/:projectId 复用同一写径（阶段闸/校验/监督日志单点实现）。
 */
describe('A-113 唱标字段配置入口（PUT opening-field-config / 模板 apply）', () => {
  let prisma: any;
  let bidController: BidController;
  let wtController: WorkTemplateController;

  const DYN: OpeningFieldDef = { key: 'projectManager', label: '项目经理', type: 'text' };
  const FIELDS: OpeningFieldDef[] = [...DEFAULT_OPENING_FIELDS, DYN];

  beforeEach(() => {
    prisma = {
      bidProject: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      workTemplate: {
        findUnique: jest.fn(), findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        delete: jest.fn(), count: jest.fn().mockResolvedValue(0),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ companyId: 'c-owner' }) },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const openingRecord = new BidOpeningRecordService(prisma, {} as any);
    const workTemplates = new WorkTemplateService(prisma);
    // BidController 其余依赖本用例路径不触碰，占位即可
    const stub = () => ({}) as any;
    bidController = new BidController(stub(), stub(), stub(), stub(), stub(), stub(), openingRecord, stub(), workTemplates);
    wtController = new WorkTemplateController(workTemplates, openingRecord);
  });

  const mockProject = (stage: string) =>
    prisma.bidProject.findUnique.mockResolvedValue({ stage, name: '测试项目', companyId: 'c-owner' });

  it('PUT fields 直给：SUBMIT 阶段成功——落 openingFieldConfig、监督日志记字段数与来源、回显 {fields}', async () => {
    mockProject('SUBMIT');
    const res = await bidController.setOpeningFieldConfig('p1', { fields: FIELDS }, 'u1');
    expect(res).toEqual({ fields: FIELDS });
    expect(prisma.bidProject.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { openingFieldConfig: { fields: FIELDS } },
    });
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: '唱标字段配置更新', result: expect.stringContaining('5 字段（来源：手工录入）'), riskFlag: '无' }),
    }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'u1', action: 'BID_OPENING_FIELD_CONFIG_SET' }),
    }));
  });

  it('PUT fields 删法定键（amount）→ 400 OPENING_FIELD_CONFIG_INVALID，不写库不落日志', async () => {
    mockProject('SUBMIT');
    await expect(bidController.setOpeningFieldConfig('p1', { fields: FIELDS.filter((f) => f.key !== 'amount') }, 'u1'))
      .rejects.toMatchObject({ response: { code: 'OPENING_FIELD_CONFIG_INVALID' } });
    expect(prisma.bidProject.update).not.toHaveBeenCalled();
    expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
  });

  it.each([['OPENING', '开标中'], ['EVALUATING', '评标中'], ['ARCHIVED', '已归档']])(
    'PUT %s 阶段 → 409 OPENING_FIELDS_LOCKED（防既有唱标记录历史列漂移），不写库',
    async (stage) => {
      mockProject(stage);
      await expect(bidController.setOpeningFieldConfig('p1', { fields: FIELDS }, 'u1'))
        .rejects.toMatchObject({ response: { code: 'OPENING_FIELDS_LOCKED' } });
      expect(prisma.bidProject.update).not.toHaveBeenCalled();
      expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
    },
  );

  it('PUT fromTemplateId：opening_record 模板成功——模板 fields 写入项目，监督日志来源记模板名', async () => {
    mockProject('DOWNLOAD');
    prisma.workTemplate.findUnique.mockResolvedValue({
      id: 'wt1', kind: 'opening_record', name: '标准唱标表',
      content: { columns: [{ key: 'amount', label: '报价' }], fields: FIELDS },
    });
    const res = await bidController.setOpeningFieldConfig('p1', { fromTemplateId: 'wt1' }, 'u1');
    expect(res).toEqual({ fields: FIELDS });
    expect(prisma.bidProject.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { openingFieldConfig: { fields: FIELDS } },
    });
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ result: expect.stringContaining('模板「标准唱标表」') }),
    }));
  });

  it('PUT fromTemplateId：模板无 fields（存量仅导出列）→ 400 TEMPLATE_NO_FIELDS', async () => {
    mockProject('DOWNLOAD');
    prisma.workTemplate.findUnique.mockResolvedValue({
      id: 'wt1', kind: 'opening_record', name: '仅导出列', content: { columns: [{ key: 'amount', label: '报价' }] },
    });
    await expect(bidController.setOpeningFieldConfig('p1', { fromTemplateId: 'wt1' }, 'u1'))
      .rejects.toMatchObject({ response: { code: 'TEMPLATE_NO_FIELDS' } });
    expect(prisma.bidProject.update).not.toHaveBeenCalled();
  });

  it('apply：evaluation 模板 → 400 TEMPLATE_KIND_MISMATCH（项目未读未写）', async () => {
    prisma.workTemplate.findUnique.mockResolvedValue({ id: 'wt9', kind: 'evaluation', name: '评分模板', content: { items: [] } });
    await expect(wtController.apply('wt9', 'p1', 'u1'))
      .rejects.toMatchObject({ response: { code: 'TEMPLATE_KIND_MISMATCH' } });
    expect(prisma.bidProject.findUnique).not.toHaveBeenCalled();
    expect(prisma.bidProject.update).not.toHaveBeenCalled();
  });

  it('R1 公司隔离：跨公司 staff apply → 403 COMPANY_SCOPE_FORBIDDEN，不写库不落日志', async () => {
    mockProject('SUBMIT');
    prisma.workTemplate.findUnique.mockResolvedValue({
      id: 'wt1', kind: 'opening_record', name: '标准唱标表', content: { fields: FIELDS },
    });
    prisma.user.findUnique.mockResolvedValue({ companyId: 'c-other' }); // 操作人属他司
    await expect(wtController.apply('wt1', 'p1', 'u1', 'staff'))
      .rejects.toMatchObject({ response: { code: 'COMPANY_SCOPE_FORBIDDEN' } });
    expect(prisma.bidProject.update).not.toHaveBeenCalled();
    expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
  });

  it('R1 公司隔离：admin 跨公司放行（不查 user.companyId），同司 staff 正常通过（前置用例已覆盖）', async () => {
    mockProject('SUBMIT');
    prisma.workTemplate.findUnique.mockResolvedValue({
      id: 'wt1', kind: 'opening_record', name: '标准唱标表', content: { fields: FIELDS },
    });
    const res = await wtController.apply('wt1', 'p1', 'u-admin', 'admin');
    expect(res).toEqual({ fields: FIELDS });
    expect(prisma.user.findUnique).not.toHaveBeenCalled(); // admin 免查
    expect(prisma.bidProject.update).toHaveBeenCalled();
  });

  it('apply：opening_record 模板成功——与 PUT 复用同一写径（同断言 update/监督日志）', async () => {
    mockProject('SUBMIT');
    prisma.workTemplate.findUnique.mockResolvedValue({
      id: 'wt1', kind: 'opening_record', name: '标准唱标表', content: { fields: FIELDS },
    });
    const res = await wtController.apply('wt1', 'p1', 'u1');
    expect(res).toEqual({ fields: FIELDS });
    expect(prisma.bidProject.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { openingFieldConfig: { fields: FIELDS } },
    });
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: '唱标字段配置更新', result: expect.stringContaining('模板「标准唱标表」') }),
    }));
  });

  it('body 二选一：两者都给 / 都缺 → 400 OPENING_FIELD_CONFIG_BODY_INVALID', async () => {
    mockProject('SUBMIT');
    await expect(bidController.setOpeningFieldConfig('p1', { fields: FIELDS, fromTemplateId: 'wt1' }, 'u1'))
      .rejects.toMatchObject({ response: { code: 'OPENING_FIELD_CONFIG_BODY_INVALID' } });
    await expect(bidController.setOpeningFieldConfig('p1', {}, 'u1'))
      .rejects.toMatchObject({ response: { code: 'OPENING_FIELD_CONFIG_BODY_INVALID' } });
    expect(prisma.bidProject.update).not.toHaveBeenCalled();
  });

  it('项目不存在 → 400 NOT_FOUND（不写库）', async () => {
    prisma.bidProject.findUnique.mockResolvedValue(null);
    await expect(bidController.setOpeningFieldConfig('nope', { fields: FIELDS }, 'u1'))
      .rejects.toMatchObject({ response: { code: 'NOT_FOUND' } });
    expect(prisma.bidProject.update).not.toHaveBeenCalled();
  });
});
