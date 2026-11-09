import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ExpertAdminService } from './expert-admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { ExpertCrossConflictService } from './expert-cross-conflict.service';
import { ExpertExtractionAiService } from './expert-extraction-ai.service';
import { NotificationService } from '../notification/notification.service';
import { EmbeddingService } from '../local-ai/embedding.service';
import { LlmService } from '../local-ai/llm.service';
import { OcrService } from '../local-ai/ocr.service';
import { ExpertExtractionService } from './expert-extraction.service';
import { CompanyScopeService } from '../company/company-scope';

/** CSV 导入·归属二段式（2026-11-09 用户裁定）：表格单位名只对公司主数据（:3005 注册
 *  全名单）精确匹配；未命中的返回 needMapping+unmatched 由前端弹窗让用户在既有公司内
 *  人工指定（companyMapping：单位名→公司 id，空串=显式不归属）——全程禁止新建公司。 */
describe('ExpertAdminService.importCsv 归属二段式', () => {
  let service: ExpertAdminService;
  let prisma: any;
  let tx: any;

  const EXISTING = { id: 'co-js', name: '四川水发建设有限公司' };
  const GROUP = { id: 'co-jt', name: '四川省水利发展集团有限公司' };
  const COMPANIES = [EXISTING, GROUP];
  const NEW_NAME = '四川水发集团某新分公司';

  /** 逐行捕获 tx.user.create 入参（归属断言看 data.companyId/company/expertProfile.employer） */
  const createdUsers: Array<{ username: string; companyId?: string; company?: string; employer?: string }> = [];

  beforeEach(async () => {
    createdUsers.length = 0;
    tx = {
      user: {
        create: jest.fn(async (args: any) => {
          const row = {
            username: args.data.username,
            companyId: args.data.companyId,
            company: args.data.company,
            employer: args.data.expertProfile?.create?.employer,
          };
          createdUsers.push(row);
          return {
            id: `u${createdUsers.length}`, username: args.data.username, displayName: args.data.username,
            email: null, passwordHash: 'h', companyId: row.companyId ?? null, company: row.company ?? null,
            expertProfile: { phone: null, idNumber: null, licenseNo: null },
          };
        }),
      },
    };
    prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(null), // 查重（importCsv 预查 + createExpert 复查）
        findUnique: jest.fn().mockResolvedValue(null), // operatorCompanyOf（sheet 模式不用其结果）
        update: jest.fn().mockResolvedValue({}), // 重导修复补录归属
      },
      company: {
        // 预解析两用：按 name.in / id.in 动态过滤（与真实查询语义一致）
        findMany: jest.fn(async (args: any) => {
          const names: string[] | undefined = args?.where?.name?.in;
          if (names) return COMPANIES.filter(c => names.includes(c.name));
          const ids: string[] | undefined = args?.where?.id?.in;
          if (ids) return COMPANIES.filter(c => ids.includes(c.id));
          return COMPANIES;
        }),
        findUnique: jest.fn(async (args: any) => COMPANIES.find(c => c.id === args.where.id) ?? null),
        findFirst: jest.fn(async (args: any) => (args.where.name === EXISTING.name ? EXISTING : null)),
        create: jest.fn(), // 禁止新建——只用于断言「未被调用」
      },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const module = await Test.createTestingModule({
      providers: [
        ExpertAdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: ExpertCrossConflictService, useValue: {} },
        { provide: ExpertExtractionAiService, useValue: {} },
        { provide: NotificationService, useValue: {} },
        { provide: EmbeddingService, useValue: {} },
        { provide: LlmService, useValue: {} },
        { provide: OcrService, useValue: {} },
        { provide: ExpertExtractionService, useValue: {} },
        { provide: CompanyScopeService, useValue: {} },
      ],
    }).compile();
    service = module.get(ExpertAdminService);
  });

  it('单位名命中主数据 → 归属既有公司（companyId 轨，工作单位同源规范名），不新建公司', async () => {
    const r = await service.importCsv([
      { 姓名: '张三', 专业领域: '水利水电', 工作单位: EXISTING.name, 身份证号: '510000199001010011' },
    ], 'op1');
    expect(prisma.company.create).not.toHaveBeenCalled();
    expect(createdUsers[0].companyId).toBe(EXISTING.id);
    expect(createdUsers[0].company).toBe(EXISTING.name);
    expect(createdUsers[0].employer).toBe(EXISTING.name);
    expect(r.needMapping ?? false).toBe(false);
    if (!r.needMapping) {
      expect(r.imported).toBe(1);
      expect(r.results[0].归属).toBe(EXISTING.name);
      expect(r.manualMappings).toEqual([]);
    }
  });

  it('单位名未命中且未给映射 → needMapping+unmatched，本轮不写任何数据', async () => {
    const r = await service.importCsv([
      { 姓名: '张三', 专业领域: '水利水电', 工作单位: NEW_NAME, 身份证号: '510000199001010011' },
    ], 'op1');
    expect(r.needMapping).toBe(true);
    if (r.needMapping) expect(r.unmatched).toEqual([NEW_NAME]);
    expect(createdUsers).toHaveLength(0);
    expect(prisma.company.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('人工指定映射 → 归属指定公司并上报 manualMappings，工作单位落公司规范名', async () => {
    const r = await service.importCsv([
      { 姓名: '李四', 专业领域: '水文地质', 工作单位: NEW_NAME, 身份证号: '510000199001010022' },
    ], 'op1', { [NEW_NAME]: GROUP.id });
    expect(prisma.company.create).not.toHaveBeenCalled();
    expect(createdUsers[0].companyId).toBe(GROUP.id);
    expect(createdUsers[0].company).toBe(GROUP.name);
    expect(createdUsers[0].employer).toBe(GROUP.name); // companyId 轨同源规范名（非表格原文）
    if (!r.needMapping) {
      expect(r.imported).toBe(1);
      expect(r.results[0].归属).toBe(GROUP.name);
      expect(r.manualMappings).toEqual([{ sheet: NEW_NAME, company: GROUP.name }]);
      expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ action: 'EXPERT_IMPORT', details: expect.objectContaining({ manualMappings: [{ sheet: NEW_NAME, company: GROUP.name }] }) }),
      }));
    }
  });

  it('映射空串=显式不归属 → 建号、无归属、工作单位保留表格原文', async () => {
    const r = await service.importCsv([
      { 姓名: '王五', 专业领域: '机电', 工作单位: NEW_NAME, 身份证号: '510000199001010033' },
    ], 'op1', { [NEW_NAME]: '' });
    expect(createdUsers).toHaveLength(1);
    expect(createdUsers[0].companyId).toBeUndefined();
    expect(createdUsers[0].employer).toBe(NEW_NAME);
    if (!r.needMapping) expect(r.results[0].归属).toBe('未归属');
  });

  it('映射指向不存在的公司 id → 400 COMPANY_NOT_FOUND', async () => {
    await expect(service.importCsv([
      { 姓名: '赵六', 专业领域: '造价', 工作单位: NEW_NAME, 身份证号: '510000199001010044' },
    ], 'op1', { [NEW_NAME]: 'co-404' })).rejects.toThrow(BadRequestException);
    expect(createdUsers).toHaveLength(0);
  });

  it('重导修复：账号已在库且未归属 + 单位名命中 → 补录归属', async () => {
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'dup-1', companyId: null }); // importCsv 查重命中
    const r = await service.importCsv([
      { 姓名: '张三', 专业领域: '水利水电', 工作单位: EXISTING.name, 身份证号: '510000199001010011' },
    ], 'op1');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'dup-1' },
      data: { companyId: EXISTING.id, company: EXISTING.name },
    });
    if (!r.needMapping) {
      expect(r.imported).toBe(0);
      expect(r.repaired).toBe(1);
      expect(r.repairedIds).toEqual(['dup-1']);
      expect(r.results[0].状态).toBe('修复归属');
      expect(r.results[0].归属).toBe(EXISTING.name);
    }
  });

  it('重导修复：未命中单位需先指定映射——携带映射后补录到指定公司', async () => {
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'dup-1', companyId: null });
    const r = await service.importCsv([
      { 姓名: '李四', 专业领域: '水文地质', 工作单位: NEW_NAME, 身份证号: '510000199001010022' },
    ], 'op1', { [NEW_NAME]: GROUP.id });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'dup-1' },
      data: { companyId: GROUP.id, company: GROUP.name },
    });
    if (!r.needMapping) {
      expect(r.repaired).toBe(1);
      expect(r.manualMappings).toEqual([{ sheet: NEW_NAME, company: GROUP.name }]);
    }
  });

  it('重导不覆盖既有归属：账号已归属 → 照旧跳过，不更新', async () => {
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'dup-2', companyId: 'co-x' });
    const r = await service.importCsv([
      { 姓名: '李四', 专业领域: '水文地质', 工作单位: EXISTING.name, 身份证号: '510000199001010022' },
    ], 'op1');
    expect(prisma.user.update).not.toHaveBeenCalled();
    if (!r.needMapping) {
      expect(r.skipped).toBe(1);
      expect(r.repaired ?? 0).toBe(0);
      expect(r.results[0].状态).toBe('跳过');
      expect(r.results[0].原因).toBe('账号已存在');
    }
  });
});
