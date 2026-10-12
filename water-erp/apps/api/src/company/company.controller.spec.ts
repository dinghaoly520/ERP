import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CompanyController } from './company.controller';
import { ROLES_KEY } from '../common/decorators/roles.decorator';

/**
 * 公司信息管理（2026-10-10）端点行为锁定：
 * - my-info 解析链（无归属 NO_COMPANY / 悬空 COMPANY_NOT_FOUND / 正常返回）
 * - 维护权限元数据（PATCH my-info 仅 leader/admin；GET 供全员预填）
 * - 改名唯一约束两道防线（前置校验 + P2002 并发兜底 → DUPLICATE_NAME）
 * - 信息字段 trim→null 归一（空串入库为 null，导出预填按空值回退默认）
 */

const COMPANY_INFO_COLUMNS = [
  'bidOpeningAddress',
  'supervisionDept',
  'supervisionAddress',
  'supervisionContact',
  'supervisionPhone',
  'purchaserAddress',
  'purchaserContact',
  'purchaserPhone',
  'purchaserEmail',
];

function makePrisma() {
  return {
    user: { findUnique: jest.fn() },
    company: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    projectManagementItem: { groupBy: jest.fn() },
    // 条目类（2026-10-10 多条目版）：my-info 附带查询
    companyPurchaser: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
    companyPlace: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
    companySupervision: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
  };
}

const COMPANY_ROW = {
  id: 'co-1',
  name: '甲公司',
  shortName: '甲',
  code: 'JIA',
  createdAt: new Date('2026-10-10T00:00:00Z'),
  ...Object.fromEntries(COMPANY_INFO_COLUMNS.map(f => [f, null])),
};

describe('CompanyController my-info（公司信息管理）', () => {
  it('按登录人 companyId 解析并返回本公司信息', async () => {
    const prisma = makePrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ companyId: 'co-1' });
    (prisma.company.findUnique as jest.Mock).mockResolvedValue(COMPANY_ROW);
    const ctrl = new CompanyController(prisma as never);

    const out = await ctrl.myInfo({ sub: 'u1', username: 'a', role: 'leader' });

    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, select: { companyId: true } }),
    );
    expect(out).toMatchObject({ id: 'co-1', name: '甲公司', code: 'JIA' });
  });

  it('账号未归属公司 → NO_COMPANY（可读错误引导联系管理员）', async () => {
    const prisma = makePrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ companyId: null });
    const ctrl = new CompanyController(prisma as never);

    await expect(ctrl.myInfo({ sub: 'u1', username: 'a', role: 'leader' })).rejects.toMatchObject({
      response: { code: 'NO_COMPANY' },
    });
  });

  it('companyId 悬空（公司已删）→ COMPANY_NOT_FOUND 而非 null', async () => {
    const prisma = makePrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ companyId: 'co-gone' });
    (prisma.company.findUnique as jest.Mock).mockResolvedValue(null);
    const ctrl = new CompanyController(prisma as never);

    await expect(ctrl.myInfo({ sub: 'u1', username: 'a', role: 'leader' })).rejects.toMatchObject({
      response: { code: 'COMPANY_NOT_FOUND' },
    });
  });

  it('PATCH my-info 权限元数据 = leader/admin（staff/bid_host 只读预填）', () => {
    const reflector = new Reflector();
    const roles = reflector.get<string[]>(ROLES_KEY, CompanyController.prototype.updateMyInfo);
    expect(roles).toEqual(['leader', 'admin']);
  });

  it('信息字段空串归一为 null（trim→null），有值字段保留 trim 结果', async () => {
    const prisma = makePrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ companyId: 'co-1' });
    (prisma.company.findUnique as jest.Mock).mockResolvedValue(COMPANY_ROW);
    (prisma.company.update as jest.Mock).mockImplementation(({ data }) => ({ ...COMPANY_ROW, ...data }));
    const ctrl = new CompanyController(prisma as never);

    await ctrl.updateMyInfo(
      { sub: 'u1', username: 'a', role: 'leader' },
      { bidOpeningAddress: '  成都市A座1楼  ', supervisionPhone: '   ', purchaserEmail: 'a@b.c' },
    );

    const data = (prisma.company.update as jest.Mock).mock.calls[0][0].data;
    expect(data.bidOpeningAddress).toBe('成都市A座1楼');
    expect(data.supervisionPhone).toBeNull();
    expect(data.purchaserEmail).toBe('a@b.c');
  });

  it('改名前置校验：名称变化时查重，撞名 → DUPLICATE_NAME', async () => {
    const prisma = makePrisma();
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ companyId: 'co-1' });
    (prisma.company.findUnique as jest.Mock).mockImplementation(({ where }) =>
      where.id ? COMPANY_ROW : { id: 'co-2' }, // 按 id 查=本公司；按 name 查=撞名
    );
    const ctrl = new CompanyController(prisma as never);

    await expect(
      ctrl.updateMyInfo({ sub: 'u1', username: 'a', role: 'leader' }, { name: '乙公司' }),
    ).rejects.toMatchObject({ response: { code: 'DUPLICATE_NAME' } });
    expect(prisma.company.update).not.toHaveBeenCalled();
  });

  it('并发窗口兜底：update 抛 P2002 唯一约束 → 友好 DUPLICATE_NAME 而非原始错误', async () => {
    const prisma = makePrisma();
    (prisma.company.findUnique as jest.Mock).mockResolvedValue(COMPANY_ROW);
    (prisma.company.update as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
    const ctrl = new CompanyController(prisma as never);

    await expect(ctrl.update('co-1', { name: '乙公司' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctrl.update('co-1', { name: '乙公司' })).rejects.toMatchObject({
      response: { code: 'DUPLICATE_NAME' },
    });
  });

  it('目标公司不存在 → NOT_FOUND', async () => {
    const prisma = makePrisma();
    (prisma.company.findUnique as jest.Mock).mockResolvedValue(null);
    const ctrl = new CompanyController(prisma as never);

    await expect(ctrl.update('co-gone', { name: '乙公司' })).rejects.toMatchObject({
      response: { code: 'NOT_FOUND' },
    });
  });
});

describe('CompanyController 采购人条目（2026-10-10 多人版）', () => {
  const user = { sub: 'u1', username: 'a', role: 'leader' } as never;

  function makePurchaserPrisma() {
    const txStub = {
      companyPurchaser: {
        create: jest.fn().mockResolvedValue({ id: 'p2' }),
        updateMany: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'p1' }),
      },
      companyPlace: { create: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
      companySupervision: { create: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    };
    return {
      user: { findUnique: jest.fn().mockResolvedValue({ companyId: 'co-1' }) },
      company: { findUnique: jest.fn().mockResolvedValue(COMPANY_ROW), findMany: jest.fn(), update: jest.fn() },
      projectManagementItem: { groupBy: jest.fn() },
      companyPurchaser: {
        findMany: jest.fn().mockResolvedValue([{ id: 'p1', name: '张三', isDefault: true }]),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
      },
      companyPlace: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
      companySupervision: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), delete: jest.fn() },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(txStub)),
      __txStub: txStub,
    };
  }

  it('my-info 附带采购人条目列表', async () => {
    const prisma = makePurchaserPrisma();
    const ctrl = new CompanyController(prisma as never);
    const out = await ctrl.myInfo(user);
    expect(prisma.companyPurchaser.findMany).toHaveBeenCalledWith({
      where: { companyId: 'co-1' },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    expect(out.purchasers).toHaveLength(1);
  });

  it('新增默认采购人：事务内先清其他默认', async () => {
    const prisma = makePurchaserPrisma();
    const ctrl = new CompanyController(prisma as never);
    await ctrl.addPurchaser(user, { name: ' 李四 ', phone: ' ', email: null, isDefault: true });
    const tx = (prisma as { __txStub: { companyPurchaser: { updateMany: jest.Mock; create: jest.Mock } } }).__txStub;
    expect(tx.companyPurchaser.updateMany).toHaveBeenCalledWith({ where: { companyId: 'co-1' }, data: { isDefault: false } });
    expect(tx.companyPurchaser.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: '李四', phone: null, isDefault: true }),
    });
  });

  it('新增空名 → 400 PURCHASER_NAME_REQUIRED', async () => {
    const prisma = makePurchaserPrisma();
    const ctrl = new CompanyController(prisma as never);
    await expect(ctrl.addPurchaser(user, { name: '  ' })).rejects.toMatchObject({
      response: { code: 'PURCHASER_NAME_REQUIRED' },
    });
  });

  it('跨公司条目编辑 → 404（不泄露存在性）', async () => {
    const prisma = makePurchaserPrisma();
    (prisma.companyPurchaser.findUnique as jest.Mock).mockResolvedValue({ id: 'px', companyId: 'co-2' });
    const ctrl = new CompanyController(prisma as never);
    await expect(ctrl.updatePurchaser(user, 'px', { name: 'x' })).rejects.toThrow('条目不存在');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('删除本公司条目正常；越权 404', async () => {
    const prisma = makePurchaserPrisma();
    (prisma.companyPurchaser.findUnique as jest.Mock).mockResolvedValue({ id: 'p1', companyId: 'co-1' });
    const ctrl = new CompanyController(prisma as never);
    await ctrl.deletePurchaser(user, 'p1');
    expect(prisma.companyPurchaser.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
  });
});

describe('CompanyController management（KPI 台账口径 · 2026-10-12 修订）', () => {
  function makeManagementPrisma() {
    const entryDelegate = () => ({
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    });
    return {
      user: { findUnique: jest.fn(), groupBy: jest.fn().mockResolvedValue([]) },
      company: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([COMPANY_ROW]),
        update: jest.fn(),
      },
      projectManagementItem: {
        groupBy: jest.fn().mockResolvedValue([{ companyId: 'co-1', _count: { _all: 19 } }]),
      },
      procurementRound: {
        groupBy: jest.fn().mockResolvedValue([
          { companyId: 'co-1', _count: { _all: 4 }, _sum: { awardAmount: 7499900 } },
        ]),
      },
      companyPurchaser: { ...entryDelegate(), groupBy: jest.fn().mockResolvedValue([{ companyId: 'co-1', _count: { _all: 2 } }]) },
      companyPlace: entryDelegate(),
      companySupervision: entryDelegate(),
    };
  }

  it('已归档/合同额按台账 AWARDED 轮次聚合（剔除回收站），在办仍走 PMI ACTIVE', async () => {
    const prisma = makeManagementPrisma();
    const ctrl = new CompanyController(prisma as never);

    const [row] = await ctrl.management();

    expect(prisma.procurementRound.groupBy).toHaveBeenCalledWith({
      by: ['companyId'],
      where: { companyId: { not: null }, resultStatus: 'AWARDED', isRecycled: false },
      _count: { _all: true },
      _sum: { awardAmount: true },
    });
    expect(prisma.projectManagementItem.groupBy).toHaveBeenCalledWith({
      by: ['companyId'],
      where: { companyId: { not: null }, status: 'ACTIVE' },
      _count: { _all: true },
    });
    expect(row).toMatchObject({ activeProjects: 19, archivedCount: 4, contractTotal: 7499900 });
  });

  it('无 AWARDED 轮次的公司归零（不再恒读 PMI ARCHIVED）', async () => {
    const prisma = makeManagementPrisma();
    (prisma.procurementRound.groupBy as jest.Mock).mockResolvedValue([
      { companyId: 'co-2', _count: { _all: 1 }, _sum: { awardAmount: 100 } },
    ]);
    const ctrl = new CompanyController(prisma as never);

    const [row] = await ctrl.management();
    expect(row).toMatchObject({ archivedCount: 0, contractTotal: 0 });
  });

  it('附带三类条目计数（台账公司列「采购人 N · 地点 N · 监督 N」）', async () => {
    const prisma = makeManagementPrisma();
    const ctrl = new CompanyController(prisma as never);

    const [row] = await ctrl.management();
    expect(row).toMatchObject({ purchaserCount: 2, placeCount: 0, supervisionCount: 0 });
  });
});

describe('CompanyController admin 按公司条目维护（2026-10-12 编辑窗口）', () => {
  function makeAdminEntryPrisma() {
    const txStub = {
      companyPurchaser: {
        create: jest.fn().mockResolvedValue({ id: 'p2' }),
        updateMany: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'p1' }),
      },
      companyPlace: { create: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
      companySupervision: { create: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    };
    const entryDelegate = () => ({
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    });
    return {
      user: { findUnique: jest.fn() },
      company: { findUnique: jest.fn().mockResolvedValue(COMPANY_ROW), findMany: jest.fn(), update: jest.fn() },
      projectManagementItem: { groupBy: jest.fn() },
      procurementRound: { groupBy: jest.fn() },
      companyPurchaser: { ...entryDelegate(), findMany: jest.fn().mockResolvedValue([{ id: 'p1', name: '张三', isDefault: true }]) },
      companyPlace: entryDelegate(),
      companySupervision: entryDelegate(),
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(txStub)),
      __txStub: txStub,
    };
  }

  it('admin 条目端点权限元数据 = 仅 admin', () => {
    const reflector = new Reflector();
    for (const fn of [
      CompanyController.prototype.companyInfoById,
      CompanyController.prototype.adminAddPurchaser,
      CompanyController.prototype.adminUpdatePurchaser,
      CompanyController.prototype.adminDeletePurchaser,
      CompanyController.prototype.adminAddPlace,
      CompanyController.prototype.adminUpdatePlace,
      CompanyController.prototype.adminDeletePlace,
      CompanyController.prototype.adminAddSupervision,
      CompanyController.prototype.adminUpdateSupervision,
      CompanyController.prototype.adminDeleteSupervision,
    ]) {
      expect(reflector.get<string[]>(ROLES_KEY, fn)).toEqual(['admin']);
    }
  });

  it('companyInfoById 返回公司 + 三类条目；公司不存在 → 404', async () => {
    const prisma = makeAdminEntryPrisma();
    const ctrl = new CompanyController(prisma as never);

    const out = await ctrl.companyInfoById('co-1');
    expect(out).toMatchObject({ id: 'co-1', name: '甲公司' });
    expect(out.purchasers).toHaveLength(1);
    expect(prisma.companyPurchaser.findMany).toHaveBeenCalledWith({
      where: { companyId: 'co-1' },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });

    (prisma.company.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(ctrl.companyInfoById('co-gone')).rejects.toThrow('公司不存在');
  });

  it('adminAddPurchaser：公司存在性闸 + 与 my-info 同套校验/写路径', async () => {
    const prisma = makeAdminEntryPrisma();
    const ctrl = new CompanyController(prisma as never);

    await ctrl.adminAddPurchaser('co-1', { name: ' 李四 ', isDefault: true });
    const tx = (prisma as { __txStub: { companyPurchaser: { updateMany: jest.Mock; create: jest.Mock } } }).__txStub;
    expect(tx.companyPurchaser.updateMany).toHaveBeenCalledWith({ where: { companyId: 'co-1' }, data: { isDefault: false } });
    expect(tx.companyPurchaser.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: '李四', isDefault: true, companyId: 'co-1' }),
    });
    // 不解析登录人公司——admin 面向路径公司
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('adminAddPurchaser 公司不存在 → 404；空名 → 400 PURCHASER_NAME_REQUIRED', async () => {
    const prisma = makeAdminEntryPrisma();
    (prisma.company.findUnique as jest.Mock).mockResolvedValueOnce(null);
    const ctrl = new CompanyController(prisma as never);
    await expect(ctrl.adminAddPurchaser('co-gone', { name: 'x' })).rejects.toThrow('公司不存在');

    await expect(ctrl.adminAddPurchaser('co-1', { name: '  ' })).rejects.toMatchObject({
      response: { code: 'PURCHASER_NAME_REQUIRED' },
    });
  });

  it('adminUpdatePurchaser 跨公司条目 → 404（不泄露存在性）；越权条目删除同口径', async () => {
    const prisma = makeAdminEntryPrisma();
    (prisma.companyPurchaser.findUnique as jest.Mock).mockResolvedValue({ id: 'px', companyId: 'co-2' });
    const ctrl = new CompanyController(prisma as never);

    await expect(ctrl.adminUpdatePurchaser('co-1', 'px', { name: 'x' })).rejects.toThrow('条目不存在');
    await expect(ctrl.adminDeletePurchaser('co-1', 'px')).rejects.toThrow('条目不存在');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.companyPurchaser.delete).not.toHaveBeenCalled();
  });

  it('adminAddPlace / adminAddSupervision 必填校验与 my-info 同码', async () => {
    const prisma = makeAdminEntryPrisma();
    const ctrl = new CompanyController(prisma as never);

    await expect(ctrl.adminAddPlace('co-1', { address: ' ' })).rejects.toMatchObject({
      response: { code: 'PLACE_REQUIRED' },
    });
    await expect(ctrl.adminAddSupervision('co-1', {})).rejects.toMatchObject({
      response: { code: 'SUPERVISION_CONTACT_REQUIRED' },
    });
  });

  it('更新不允许把标识字段清空（纵深防御：UI 拦空值，此处拦直连 API 绕过）', async () => {
    const prisma = makeAdminEntryPrisma();
    const ctrl = new CompanyController(prisma as never);

    await expect(ctrl.adminUpdatePurchaser('co-1', 'p1', { name: '  ' })).rejects.toMatchObject({
      response: { code: 'PURCHASER_NAME_REQUIRED' },
    });
    await expect(ctrl.adminUpdatePlace('co-1', 'px', { address: '' })).rejects.toMatchObject({
      response: { code: 'PLACE_REQUIRED' },
    });
    await expect(ctrl.adminUpdateSupervision('co-1', 'px', { contact: ' ' })).rejects.toMatchObject({
      response: { code: 'SUPERVISION_CONTACT_REQUIRED' },
    });
    // 三个 build*Update 在校验前即抛出，不应触达事务
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
