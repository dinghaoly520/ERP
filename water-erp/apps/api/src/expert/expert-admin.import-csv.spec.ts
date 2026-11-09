import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
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

/** CSV 导入·表格归属（2026-11-09 用户裁定）：单位名先对公司主数据（:3005 注册全名单）
 *  精确匹配，未命中也按表格名直接建档归属——不再落「未归属」；新建公司清单显式上报。 */
describe('ExpertAdminService.importCsv 表格归属', () => {
  let service: ExpertAdminService;
  let prisma: any;
  let tx: any;

  const EXISTING = { id: 'co-js', name: '四川水发建设有限公司' };
  const NEW_NAME = '四川水发集团某新分公司';

  /** 逐行捕获 tx.user.create 入参（归属断言看 data.companyId/company） */
  const createdUsers: Array<{ username: string; companyId?: string; company?: string }> = [];

  beforeEach(async () => {
    createdUsers.length = 0;
    tx = {
      user: {
        create: jest.fn(async (args: any) => {
          const row = { username: args.data.username, companyId: args.data.companyId, company: args.data.company };
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
        findMany: jest.fn().mockResolvedValue([{ name: EXISTING.name }]), // 导入前主数据快照
        findFirst: jest.fn(async (args: any) => (args.where.name === EXISTING.name ? EXISTING : null)),
        create: jest.fn(async (args: any) => ({ id: 'co-new-1', name: args.data.name })),
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

  it('单位名命中公司主数据 → 归属既有公司，不新建档案', async () => {
    const r = await service.importCsv([
      { 姓名: '张三', 专业领域: '水利水电', 工作单位: EXISTING.name, 身份证号: '510000199001010011' },
    ], 'op1');
    expect(prisma.company.create).not.toHaveBeenCalled();
    expect(createdUsers[0].companyId).toBe(EXISTING.id);
    expect(createdUsers[0].company).toBe(EXISTING.name);
    expect(r.imported).toBe(1);
    expect(r.results[0].归属).toBe(EXISTING.name);
    expect(r.createdCompanies).toEqual([]);
  });

  it('单位名未命中主数据 → 按表格名建档并归属，上报新建公司清单', async () => {
    const r = await service.importCsv([
      { 姓名: '张三', 专业领域: '水利水电', 工作单位: EXISTING.name, 身份证号: '510000199001010011' },
      { 姓名: '赵六', 专业领域: '工程造价', 工作单位: EXISTING.name, 身份证号: '510000199001010044' },
      { 姓名: '李四', 专业领域: '水文地质', 工作单位: NEW_NAME, 身份证号: '510000199001010022' },
    ], 'op1');
    expect(prisma.company.create).toHaveBeenCalledTimes(1);
    expect(prisma.company.create).toHaveBeenCalledWith(expect.objectContaining({ data: { name: NEW_NAME } }));
    expect(createdUsers.map(u => u.companyId)).toEqual([EXISTING.id, EXISTING.id, 'co-new-1']);
    expect(r.results.map(x => x.归属)).toEqual([EXISTING.name, EXISTING.name, NEW_NAME]);
    expect(r.createdCompanies).toEqual([NEW_NAME]);
    // 计数降序（两家计数拉开，断言不依赖中文排序细则）
    expect(r.companies).toEqual([
      { name: EXISTING.name, count: 2 },
      { name: NEW_NAME, count: 1 },
    ]);
    // 新建公司进审计留痕
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'EXPERT_IMPORT', details: expect.objectContaining({ createdCompanies: [NEW_NAME] }) }),
    }));
  });

  it('建档撞并发唯一约束(P2002) → 回读既有行归属', async () => {
    prisma.company.findFirst
      .mockResolvedValueOnce(null) // 首查未命中
      .mockResolvedValueOnce({ id: 'co-raced', name: NEW_NAME }); // P2002 后回读
    prisma.company.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }),
    );
    const r = await service.importCsv([
      { 姓名: '王五', 专业领域: '机电', 工作单位: NEW_NAME, 身份证号: '510000199001010033' },
    ], 'op1');
    expect(createdUsers[0].companyId).toBe('co-raced');
    expect(r.imported).toBe(1);
  });

  it('重导修复：账号已在库且未归属 + 表格带单位名 → 按表格补录归属（建档语义同新导入）', async () => {
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'dup-1', companyId: null }); // importCsv 查重命中
    const r = await service.importCsv([
      { 姓名: '张三', 专业领域: '水利水电', 工作单位: NEW_NAME, 身份证号: '510000199001010011' },
    ], 'op1');
    expect(prisma.company.create).toHaveBeenCalledWith(expect.objectContaining({ data: { name: NEW_NAME } }));
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'dup-1' },
      data: { companyId: 'co-new-1', company: NEW_NAME },
    });
    expect(r.imported).toBe(0);
    expect(r.repaired).toBe(1);
    expect(r.repairedIds).toEqual(['dup-1']);
    expect(r.results[0].状态).toBe('修复归属');
    expect(r.results[0].归属).toBe(NEW_NAME);
    expect(r.createdCompanies).toEqual([NEW_NAME]);
    // 审计留痕带 repaired
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'EXPERT_IMPORT', details: expect.objectContaining({ repaired: 1 }) }),
    }));
  });

  it('重导不覆盖既有归属：账号已归属（含曾入库审核者）→ 照旧跳过，不建档不更新', async () => {
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'dup-2', companyId: 'co-x' });
    const r = await service.importCsv([
      { 姓名: '李四', 专业领域: '水文地质', 工作单位: NEW_NAME, 身份证号: '510000199001010022' },
    ], 'op1');
    expect(prisma.company.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(r.skipped).toBe(1);
    expect(r.repaired ?? 0).toBe(0);
    expect(r.results[0].状态).toBe('跳过');
    expect(r.results[0].原因).toBe('账号已存在');
  });
});
