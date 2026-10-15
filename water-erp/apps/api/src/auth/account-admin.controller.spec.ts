import { Test, TestingModule } from '@nestjs/testing';
import { AccountAdminController } from './account-admin.controller';
import { PrismaService } from '../prisma/prisma.service';
import { openPii, isSealedFieldSm, blindIndexPii } from '../common/crypto/sm-field-crypto';

/**
 * 掩码回声防御（2026-10-15）：
 * 账号管理列表/详情出口是掩码（maskPhone/maskEmail），编辑表单回填掩码值；
 * 管理员原样保存 → sealPii('173****0762') 把掩码串当明文密封入库 →
 * 本人 /auth/me 拆封回显掩码串 → 个人中心资料修改校验拒绝 → 无法提交任何变更。
 * 修复口径（与 supervision authToken '******'=保持现有 同惯例）：
 * 含 * 的 phone/email 一律视为「未修改」剔除；空串=清空语义不变；正常值密封写入。
 */
describe('AccountAdminController — 掩码回声防御（2026-10-15）', () => {
  let controller: AccountAdminController;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      user: { update: jest.fn(), findFirst: jest.fn() },
      company: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccountAdminController],
      providers: [{ provide: PrismaService, useValue: prisma }],
    }).compile();
    controller = module.get(AccountAdminController);
  });

  const callUpdate = (dto: any) =>
    controller.update('u1', dto, { sub: 'admin1', username: 'admin', role: 'admin' } as any);

  it('提交掩码手机号（173****0762）→ 不写 phone/phoneIdx（视为未修改）', async () => {
    prisma.user.update.mockResolvedValue({ id: 'u1', username: 'zr', displayName: '曾蕊' });

    await callUpdate({ phone: '173****0762' });

    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('phone');
    expect(data).not.toHaveProperty('phoneIdx');
  });

  it('提交掩码邮箱（a***@x.com）→ 不写 email', async () => {
    prisma.user.update.mockResolvedValue({ id: 'u1', username: 'zr', displayName: '曾蕊' });

    await callUpdate({ email: 'a***@x.com' });

    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('email');
  });

  it('正常手机号 → 密封落库 + 盲索引同步', async () => {
    prisma.user.update.mockResolvedValue({ id: 'u1', username: 'zr', displayName: '曾蕊' });

    await callUpdate({ phone: '13812345678' });

    const data = prisma.user.update.mock.calls[0][0].data;
    expect(isSealedFieldSm(data.phone)).toBe(true);
    expect(openPii(data.phone)).toBe('13812345678');
    expect(data.phoneIdx).toBe(blindIndexPii('13812345678'));
  });

  it('空串手机号 → 清空（phone null + phoneIdx null），语义不变', async () => {
    prisma.user.update.mockResolvedValue({ id: 'u1', username: 'zr', displayName: '曾蕊' });

    await callUpdate({ phone: '' });

    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data.phone).toBeNull();
    expect(data.phoneIdx).toBeNull();
  });

  it('正常邮箱 → 密封落库（掩码防御不影响正常写入）', async () => {
    prisma.user.update.mockResolvedValue({ id: 'u1', username: 'zr', displayName: '曾蕊' });

    await callUpdate({ email: 'zr@example.com' });

    const data = prisma.user.update.mock.calls[0][0].data;
    expect(isSealedFieldSm(data.email)).toBe(true);
    expect(openPii(data.email)).toBe('zr@example.com');
  });
});
