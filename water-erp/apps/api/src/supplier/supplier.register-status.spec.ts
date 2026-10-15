import { Test } from '@nestjs/testing';
import { SupplierService } from './supplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { VerificationService } from '../verification/verification.service';
import { LlmService } from '../local-ai/llm.service';
import { CompanyScopeService } from '../company/company-scope';

/** 公开进度查询（按企业名称，2026-10-14）：零命中 / 唯一命中 / 同名多条（打码候选）。 */
describe('SupplierService.getRegisterStatusByName — 按企业名称查询审核进度', () => {
  let service: SupplierService;
  let prisma: any;

  const supplier = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 's1',
    name: '四川岷江水利水电工程有限公司',
    creditCode: '91510100MA6C1234X9',
    status: 'PENDING',
    returnReason: null,
    urgedAt: null,
    reviewStage: 'STAFF',
    ...over,
  });

  beforeEach(async () => {
    prisma = {
      supplier: { findMany: jest.fn().mockResolvedValue([]) },
      supplierApprovalRecord: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]), // 审核节点时间线（2026-10-15）
      },
    };
    const module = await Test.createTestingModule({
      providers: [
        { provide: CompanyScopeService, useValue: { resolveScope: jest.fn().mockResolvedValue({ all: true }), filter: jest.fn().mockReturnValue({}), assertInScope: jest.fn(), stampFor: jest.fn().mockResolvedValue({}) } },
        SupplierService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn().mockResolvedValue({}), sendToUser: jest.fn().mockResolvedValue({}) } },
        { provide: 'REDIS_CLIENT', useValue: {} },
        { provide: LlmService, useValue: {} },
        { provide: VerificationService, useValue: {} },
      ],
    }).compile();
    service = module.get(SupplierService);
  });

  it('零命中 → found:false，与信用代码路径口径一致（不泄漏是否存在）', async () => {
    prisma.supplier.findMany.mockResolvedValue([]);
    const r = await service.getRegisterStatusByName('不存在的公司');
    expect(r).toEqual({ found: false, name: null, status: null, reason: null, reviewedAt: null, urgedAt: null });
  });

  it('唯一命中（在审）→ 同构返回 + reviewStage + 附 creditCode 供催促按钮', async () => {
    prisma.supplier.findMany.mockResolvedValue([supplier()]);
    const r: any = await service.getRegisterStatusByName('四川岷江水利水电工程有限公司');
    expect(r.found).toBe(true);
    expect(r.status).toBe('PENDING');
    expect(r.reviewStage).toBe('STAFF');
    expect(r.reviewStageLabel).toBeTruthy();
    // 公开工商信息：唯一命中时回传完整信用代码，前端催促审核复用
    expect(r.creditCode).toBe('91510100MA6C1234X9');
  });

  it('唯一命中（已入库）→ reviewStage 为 null、creditCode 仍回传', async () => {
    prisma.supplier.findMany.mockResolvedValue([supplier({ status: 'APPROVED', reviewStage: null })]);
    const r: any = await service.getRegisterStatusByName('四川岷江水利水电工程有限公司');
    expect(r.found).toBe(true);
    expect(r.status).toBe('APPROVED');
    expect(r.reviewStage).toBeNull();
    expect(r.creditCode).toBe('91510100MA6C1234X9');
  });

  it('同名多条 → ambiguous + 打码候选（6+8+4），不回传完整信用代码', async () => {
    prisma.supplier.findMany.mockResolvedValue([
      supplier({ id: 's1', creditCode: '91510100MA6C1234X9', reviewStage: 'LEADER' }),
      supplier({ id: 's2', creditCode: '91510100MA6C5678B2', status: 'APPROVED', reviewStage: null }),
    ]);
    const r: any = await service.getRegisterStatusByName('四川岷江水利水电工程有限公司');
    expect(r.found).toBe(false);
    expect(r.ambiguous).toBe(true);
    expect(r.candidates).toHaveLength(2);
    expect(r.candidates[0]).toMatchObject({
      creditCodeMasked: '915101********34X9',
      status: 'PENDING',
      reviewStage: 'LEADER',
    });
    expect(r.candidates[1].creditCodeMasked).toBe('915101********78B2');
    expect(r.creditCode).toBeUndefined();
    // 打码候选不含完整信用代码
    expect(JSON.stringify(r)).not.toContain('91510100MA6C1234X9');
  });

  it('审核节点时间线：留痕逐条返回，REJECTED 缘由不披露、RETURNED 节点披露补正说明', async () => {
    prisma.supplier.findMany.mockResolvedValue([supplier({ status: 'APPROVED' })]);
    prisma.supplierApprovalRecord.findFirst.mockResolvedValue({ createdAt: new Date(), action: 'APPROVED' });
    prisma.supplierApprovalRecord.findMany.mockResolvedValue([
      { stage: 'STAFF', action: 'APPROVED', reason: '材料齐备', createdAt: new Date('2026-10-15T08:00:00Z') },
      { stage: 'LEADER', action: 'APPROVED', reason: '复核无异议', createdAt: new Date('2026-10-15T09:00:00Z') },
      { stage: 'ADMIN', action: 'APPROVED', reason: '终审通过', createdAt: new Date('2026-10-15T10:00:00Z') },
    ]);
    const r: any = await service.getRegisterStatusByName('四川岷江水利水电工程有限公司');
    expect(r.timeline).toHaveLength(3);
    expect(r.timeline[0]).toMatchObject({ stage: 'STAFF', action: 'APPROVED', at: new Date('2026-10-15T08:00:00Z') });
    // 审批缘由不外发（可能含内部口径），仅 RETURNED 节点披露
    expect(JSON.stringify(r.timeline)).not.toContain('材料齐备');
    expect(r.timeline.every((n: any) => n.reason === null)).toBe(true);
  });

  it('审核完成超 3 日 → closedAfterCompletion，不再披露状态/时间线', async () => {
    prisma.supplier.findMany.mockResolvedValue([supplier({ status: 'APPROVED', reviewStage: null })]);
    prisma.supplierApprovalRecord.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 4 * 86400000), action: 'APPROVED' });
    prisma.supplierApprovalRecord.findMany.mockResolvedValue([
      { stage: 'ADMIN', action: 'APPROVED', reason: null, createdAt: new Date(Date.now() - 4 * 86400000) },
    ]);
    const r: any = await service.getRegisterStatusByName('四川岷江水利水电工程有限公司');
    expect(r.found).toBe(false);
    expect(r.closedAfterCompletion).toBe(true);
    expect(r.status).toBeNull();
    expect(r.timeline).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('APPROVED');
  });

  it('审核完成 3 日内 → 仍可查询（时间线可见）', async () => {
    prisma.supplier.findMany.mockResolvedValue([supplier({ status: 'APPROVED', reviewStage: null })]);
    prisma.supplierApprovalRecord.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 2 * 86400000), action: 'APPROVED' });
    prisma.supplierApprovalRecord.findMany.mockResolvedValue([
      { stage: 'ADMIN', action: 'APPROVED', reason: null, createdAt: new Date(Date.now() - 2 * 86400000) },
    ]);
    const r: any = await service.getRegisterStatusByName('四川岷江水利水电工程有限公司');
    expect(r.found).toBe(true);
    expect(r.status).toBe('APPROVED');
    expect(r.timeline).toHaveLength(1);
  });

  it('RETURNED 状态返回补正说明，REJECTED 不返回拒绝原因（与信用代码路径同口径）', async () => {
    prisma.supplier.findMany.mockResolvedValue([
      supplier({ status: 'RETURNED', returnReason: '营业执照不清晰，请重传' }),
    ]);
    const returned: any = await service.getRegisterStatusByName('四川岷江水利水电工程有限公司');
    expect(returned.reason).toBe('营业执照不清晰，请重传');

    prisma.supplier.findMany.mockResolvedValue([
      supplier({ status: 'REJECTED', returnReason: null }),
    ]);
    // REJECTED 为终态——3 日截止口径下须用近期时间（否则触发 closedAfterCompletion）
    prisma.supplierApprovalRecord.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 86400000), action: 'REJECTED' });
    const rejected: any = await service.getRegisterStatusByName('四川岷江水利水电工程有限公司');
    expect(rejected.reason).toBeNull();
    expect(rejected.reviewedAction).toBe('REJECTED');
  });
});
