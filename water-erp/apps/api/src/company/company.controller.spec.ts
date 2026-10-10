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
