import { SupplierService } from './supplier.service';
import { sealPii } from '../common/crypto/sm-field-crypto';

/** 直构（构造序 prisma, notificationService, redis, llm, verificationService, companyScope）：
 *  撤回链只触 prisma/notification/verification 三个依赖面。PII 列走 sealPii 真密封 fixture
 *  （openPii 严格拆封：明文值会抛错），保证手机一致性校验按真实链路可比。 */
const SEALED_PHONE = sealPii('13800138000') as string;
const mkSvc = (opts: {
  findFirst?: Record<string, unknown> | null;
  findUnique?: Record<string, unknown> | null;
  claimCount?: number;
  withdrawCount?: number;
  sessionPhone?: string;
} = {}) => {
  const fullRow = {
    id: 'sup-1', name: '成都测试商贸有限公司', creditCode: '91510100MA00000000',
    status: 'PENDING', reviewStage: 'STAFF', companyId: 'co-1', userId: 'u1',
    returnReason: null, withdrawCount: opts.withdrawCount ?? 0,
    contacts: [{ isPrimary: true, phone: SEALED_PHONE }],
    qualifications: [], bankAccounts: [], performances: [],
  };
  const prisma: any = {
    supplier: {
      findFirst: jest.fn().mockResolvedValue(opts.findFirst === undefined ? fullRow : opts.findFirst),
      findUnique: jest.fn().mockResolvedValue(opts.findUnique ?? fullRow),
      updateMany: jest.fn().mockResolvedValue({ count: opts.claimCount ?? 1 }),
    },
    user: { update: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([{ id: 'rev-1' }]) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    supplierApprovalRecord: {
      create: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const notification: any = { create: jest.fn().mockResolvedValue({}), resolveActionable: jest.fn().mockResolvedValue({ count: 1 }) };
  const verification: any = {
    sendRegistrationCode: jest.fn().mockResolvedValue({ ok: true }),
    verifyAndStartRegistrationSession: jest.fn().mockResolvedValue({ token: 'w'.repeat(64), expiresIn: 600 }),
    assertRegistrationSession: jest.fn().mockResolvedValue({ phone: opts.sessionPhone ?? '13800138000' }),
    consumeRegistrationSession: jest.fn().mockResolvedValue({ ok: true }),
  };
  const svc = new (SupplierService as any)(prisma, notification, null, null, verification, null);
  return { svc, prisma, notification, verification };
};

const TOKEN = 'w'.repeat(64);

describe('供应商撤销申请（2026-11-25 spec）', () => {
  const baseRow = (over: Record<string, unknown> = {}) => ({
    id: 'sup-1', name: '成都测试商贸有限公司', creditCode: '91510100MA00000000',
    status: 'PENDING', reviewStage: 'STAFF', companyId: 'co-1', userId: 'u1',
    returnReason: null, withdrawCount: 0,
    contacts: [{ isPrimary: true, phone: SEALED_PHONE }],
    qualifications: [], bankAccounts: [], performances: [],
    ...over,
  });

  it('requestWithdraw：PENDING/RETURNED 命中 → 发码（注册场景）并回掩码手机', async () => {
    const { svc, verification } = mkSvc({ findFirst: baseRow() });
    const r = await svc.requestWithdraw('成都测试商贸有限公司', '91510100MA00000000', '127.0.0.1');
    expect(r.maskedPhone).toBeTruthy();
    expect(verification.sendRegistrationCode).toHaveBeenCalledWith('13800138000', '127.0.0.1', 'supplier_registration');
  });

  it('requestWithdraw：未命中（已入库/不存在）→ 同形响应 maskedPhone:null，零发码', async () => {
    const { svc, verification } = mkSvc({ findFirst: null });
    const r = await svc.requestWithdraw('不存在公司', '91510100MA00000000', 'ip');
    expect(r).toEqual({ maskedPhone: null });
    expect(verification.sendRegistrationCode).not.toHaveBeenCalled();
  });

  it('withdrawSubmit：乐观锁认领 WITHDRAWN + 计数 +1 + returnReason 清空', async () => {
    const { svc, prisma } = mkSvc({ findFirst: baseRow({ status: 'RETURNED', returnReason: '材料不清' }) });
    const r = await svc.withdrawSubmit(TOKEN, '成都测试商贸有限公司', '91510100MA00000000');
    expect(r).toEqual({ success: true });
    expect(prisma.supplier.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sup-1', status: { in: ['PENDING', 'RETURNED'] } },
      data: expect.objectContaining({ status: 'WITHDRAWN', returnReason: null, withdrawCount: { increment: 1 } }),
    }));
  });

  it('withdrawSubmit：业务数据与子表保留（不走 purge——user.update 只清密码/停用）', async () => {
    const { svc, prisma } = mkSvc({ findFirst: baseRow() });
    await svc.withdrawSubmit(TOKEN, '成都测试商贸有限公司', '91510100MA00000000');
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'u1' },
      data: expect.objectContaining({ passwordHash: null, isActive: false }),
    }));
    expect(prisma.supplierContact?.deleteMany).toBeUndefined();
  });

  it('withdrawSubmit：审批人通知 + 审批人待办清理 + 审计 + 留痕 WITHDRAWN', async () => {
    const { svc, prisma, notification } = mkSvc({ findFirst: baseRow() });
    await svc.withdrawSubmit(TOKEN, '成都测试商贸有限公司', '91510100MA00000000');
    expect(notification.create).toHaveBeenCalledWith(expect.objectContaining({
      type: 'SUPPLIER_WITHDRAWN', title: '供应商撤回注册申请',
    }));
    expect(notification.resolveActionable).toHaveBeenCalledWith('SUPPLIER_PENDING', '/supplier/sup-1');
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'SUPPLIER_WITHDRAWN' }),
    }));
    expect(prisma.supplierApprovalRecord.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'WITHDRAWN', stage: 'STAFF' }),
    }));
  });

  it('withdrawSubmit：次数闸——已达 3 次 → 400 WITHDRAW_LIMIT_REACHED，零认领', async () => {
    const { svc, prisma } = mkSvc({ findFirst: baseRow({ withdrawCount: 3 }) });
    await expect(svc.withdrawSubmit(TOKEN, '成都测试商贸有限公司', '91510100MA00000000'))
      .rejects.toMatchObject({ response: { code: 'WITHDRAW_LIMIT_REACHED' } });
    expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
  });

  it('withdrawSubmit：状态闸——APPROVED/REJECTED/WITHDRAWN 不可撤', async () => {
    for (const status of ['APPROVED', 'REJECTED', 'WITHDRAWN']) {
      const { svc, prisma } = mkSvc({ findFirst: null });
      await expect(svc.withdrawSubmit(TOKEN, '成都测试商贸有限公司', '91510100MA00000000'))
        .rejects.toMatchObject({ response: { code: 'WITHDRAW_NOT_FOUND' } });
      expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
    }
  });

  it('withdrawSubmit：并发认领失败（count=0）→ 400 CONFLICT', async () => {
    const { svc } = mkSvc({ findFirst: baseRow(), claimCount: 0 });
    await expect(svc.withdrawSubmit(TOKEN, '成都测试商贸有限公司', '91510100MA00000000'))
      .rejects.toMatchObject({ response: { code: 'CONFLICT' } });
  });

  it('withdrawSubmit：手机不匹配 → 400 WITHDRAW_PHONE_MISMATCH', async () => {
    const { svc, verification } = mkSvc({ findFirst: baseRow(), sessionPhone: '13900000000' });
    await expect(svc.withdrawSubmit(TOKEN, '成都测试商贸有限公司', '91510100MA00000000'))
      .rejects.toMatchObject({ response: { code: 'WITHDRAW_PHONE_MISMATCH' } });
  });

  it('getWithdrawDraft：仅 WITHDRAWN 可取；PII 明文回填形态（openPii 直通）', async () => {
    const { svc } = mkSvc({
      findUnique: baseRow({ status: 'WITHDRAWN', returnReason: null,
        enterpriseType: '有限责任公司', legalPerson: '张三', legalPersonIdCard: sealPii('510104199001011234'),
        registeredAddress: '成都市', businessScope: '销售' }),
    });
    const d = await svc.getWithdrawDraft(TOKEN, '成都测试商贸有限公司', '91510100MA00000000');
    expect(d.name).toBe('成都测试商贸有限公司');
    expect(d.contacts).toHaveLength(1);
    expect(d.contacts[0].phone).toBe('13800138000');
  });

  it('getWithdrawDraft：非 WITHDRAWN → 400', async () => {
    const { svc } = mkSvc({ findFirst: null }); // draft 定位走 findFirst（WITHDRAWN 过滤）
    await expect(svc.getWithdrawDraft(TOKEN, '成都测试商贸有限公司', '91510100MA00000000'))
      .rejects.toMatchObject({ response: { code: 'WITHDRAW_NOT_FOUND' } });
  });

  it('公开进度投影含 withdrawCount', async () => {
    const { svc } = mkSvc({ findFirst: baseRow({ withdrawCount: 2 }) });
    const r = await svc.getRegisterStatusByCreditCode('91510100MA00000000');
    expect(r.found).toBe(true);
    expect(r.withdrawCount).toBe(2);
  });
});
