import { SupplierPortalService } from './supplier-portal.service';

/**
 * 供应商门户「申请资料变更」新增统一社会信用代码变更项（2026-11-10 用户裁定）：
 * createChangeRequest（:3004 入口）四闸——18 位格式 / 同值 / 全库查重 / 登录名占用
 * （username=信用代码三处强制口径：注册 supplier.service:290 / 临时注册 :813 / Excel 导入 :4554）。
 */
const OLD_CODE = '91510000MA62K5XX0X';
const NEW_CODE = '91510000MA62K5YY1Y';

describe('SupplierPortalService 资料变更·统一社会信用代码', () => {
  let service: SupplierPortalService;
  let prisma: any;

  const supplierFixture = {
    id: 'sup-1',
    userId: 'user-1',
    name: '测试供应商',
    status: 'APPROVED',
    isTemporary: false,
    companyId: null,
    creditCode: OLD_CODE,
    organizationCode: OLD_CODE,
  };

  beforeEach(() => {
    prisma = {
      supplier: {
        findUnique: jest.fn().mockResolvedValue(supplierFixture),
        findFirst: jest.fn().mockResolvedValue(null), // 默认：新代码无占用
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(null), // 默认：登录名无占用
        findMany: jest.fn().mockResolvedValue([]), // notifyChangeReviewers 收件人解析（admin 兜底空）
      },
      notification: { create: jest.fn().mockResolvedValue({}) },
      supplierChangeRecord: {
        create: jest.fn().mockResolvedValue({ id: 'chg-1' }),
      },
    };
    service = Object.create(SupplierPortalService.prototype) as SupplierPortalService;
    Object.assign(service, { prisma, notifications: undefined });
  });

  it('白名单放行：合法新代码 → 落变更记录（fieldLabel 服务端词表归一）', async () => {
    await service.createChangeRequest('sup-1', 'user-1', {
      fieldName: 'creditCode',
      fieldLabel: 'creditCode', // 裸英文 label 不信任——服务端词表恒中文
      newValue: NEW_CODE,
      reason: '三证合一换新码',
    });
    expect(prisma.supplierChangeRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        supplierId: 'sup-1',
        fieldName: 'creditCode',
        fieldLabel: '统一社会信用代码',
        oldValue: OLD_CODE,
        newValue: NEW_CODE,
        status: 'PENDING',
      }),
    });
  });

  it('格式非法（非 18 位大写字母/数字）→ INVALID_CREDIT_CODE', async () => {
    await expect(
      service.createChangeRequest('sup-1', 'user-1', { fieldName: 'creditCode', fieldLabel: '统一社会信用代码', newValue: '9151000abc', reason: 'x' }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_CREDIT_CODE' } });
    expect(prisma.supplierChangeRecord.create).not.toHaveBeenCalled();
  });

  it('小写字母 → 拒收（18 位大写口径与注册/转正一致）', async () => {
    await expect(
      service.createChangeRequest('sup-1', 'user-1', { fieldName: 'creditCode', fieldLabel: '统一社会信用代码', newValue: NEW_CODE.toLowerCase(), reason: 'x' }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_CREDIT_CODE' } });
  });

  it('新代码与当前值相同 → NO_CHANGE', async () => {
    await expect(
      service.createChangeRequest('sup-1', 'user-1', { fieldName: 'creditCode', fieldLabel: '统一社会信用代码', newValue: OLD_CODE, reason: 'x' }),
    ).rejects.toMatchObject({ response: { code: 'NO_CHANGE' } });
  });

  it('新代码已被其他供应商占用 → DUPLICATE_CREDIT_CODE', async () => {
    prisma.supplier.findFirst.mockResolvedValue({ id: 'sup-other' });
    await expect(
      service.createChangeRequest('sup-1', 'user-1', { fieldName: 'creditCode', fieldLabel: '统一社会信用代码', newValue: NEW_CODE, reason: 'x' }),
    ).rejects.toMatchObject({ response: { code: 'DUPLICATE_CREDIT_CODE' } });
  });

  it('新代码已被其他账号占用为登录名 → DUPLICATE_USERNAME', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'user-other' });
    await expect(
      service.createChangeRequest('sup-1', 'user-1', { fieldName: 'creditCode', fieldLabel: '统一社会信用代码', newValue: NEW_CODE, reason: 'x' }),
    ).rejects.toMatchObject({ response: { code: 'DUPLICATE_USERNAME' } });
  });
});
