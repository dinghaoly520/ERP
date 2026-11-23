import { AuthService } from './auth.service';

/* :3011 移动驾驶舱手机号登录（2026-11-23 用户裁定）——白名单/账号形态/会话签发单测。
 * 白名单硬编码：19981208777→王华董事长、13882199205→张宏董事长（短信码）；13368360619 固定密码 123456；
 * 名单外拒绝（报「无法接收短信」）。账号 username=手机号、role=admin，find-or-create（seed 重灌自愈）。 */
describe('AuthService 移动驾驶舱手机号登录', () => {
  const makeService = (userRow?: Record<string, unknown>) => {
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(userRow ?? null),
        create: jest.fn().mockResolvedValue({ id: 'u-new', username: '19981208777', role: 'admin' }),
        update: jest.fn().mockResolvedValue({ id: 'u-x', username: 'x', role: 'admin' }),
      },
    };
    const jwt = { sign: jest.fn().mockReturnValue('tok') };
    const verification = {
      sendMobileLoginCode: jest.fn().mockResolvedValue({ maskedPhone: '199****8777' }),
      validateMobileLoginCode: jest.fn().mockResolvedValue({ ok: true }),
    };
    const svc = new AuthService(prisma as never, jwt as never, verification as never);
    return { svc, prisma, jwt, verification };
  };

  it('mobileIdentityFor：两部董事长手机→短信、13368360619→固定密码、名单外→null', () => {
    const { svc } = makeService();
    expect(svc.mobileIdentityFor('19981208777')).toEqual({ mode: 'sms', displayName: '王华董事长', org: '水发集团' });
    expect(svc.mobileIdentityFor('13882199205')).toEqual({ mode: 'sms', displayName: '张宏董事长', org: '设计公司' });
    // 13368360619 双通道（2026-11-23 用户裁定：短信测试一律走此号）——短信名单在册，密码名单另有其固定口令
    expect(svc.mobileIdentityFor('13368360619')).toEqual({ mode: 'sms', displayName: '系统管理员', org: '水发集团' });
    expect(svc.mobileIdentityFor('13800000000')).toBeNull();
    expect(svc.mobileIdentityFor('')).toBeNull();
  });

  it('sendMobileLoginCode：短信名单放行并转发 verification；名单外报「无法接收短信」；密码号不发短信', async () => {
    const { svc, verification } = makeService();
    await expect(svc.sendMobileLoginCode('19981208777', '1.2.3.4')).resolves.toEqual({ maskedPhone: '199****8777' });
    expect(verification.sendMobileLoginCode).toHaveBeenCalledWith('19981208777', '1.2.3.4');
    await expect(svc.sendMobileLoginCode('13800000000', '1.2.3.4')).rejects.toMatchObject({ response: { code: 'MOBILE_PHONE_NOT_ALLOWED' } });
    // 13368360619 亦可收短信（测试通道）
    await expect(svc.sendMobileLoginCode('13368360619', '1.2.3.4')).resolves.toEqual({ maskedPhone: '133****0619' });
    expect(verification.sendMobileLoginCode).toHaveBeenCalledTimes(2);
  });

  it('mobileSmsLogin：码校验→find-or-create→轮换 web 会话（token 含 username=手机号）', async () => {
    const { svc, prisma } = makeService();
    const r = await svc.mobileSmsLogin('19981208777', '123456');
    expect(r).toMatchObject({ access_token: 'tok', role: 'admin', username: '19981208777' });
    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ username: '19981208777', displayName: '王华董事长', role: 'admin', company: '水发集团' }),
    }));
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u-new' } }));
  });

  it('mobileSmsLogin：冻结账号拒绝（ACCOUNT_FROZEN）', async () => {
    const { svc } = makeService({ id: 'u-1', username: '19981208777', role: 'admin', isFrozen: true, isActive: true });
    await expect(svc.mobileSmsLogin('19981208777', '123456')).rejects.toMatchObject({ response: { code: 'ACCOUNT_FROZEN' } });
  });

  it('mobileSmsLogin：既有账号复用不重建；公司快照缺失自愈改写（抬头组织标注数据源）', async () => {
    const { svc, prisma } = makeService({ id: 'u-1', username: '19981208777', role: 'admin', isFrozen: false, isActive: true, displayName: '王华董事长', company: null });
    await svc.mobileSmsLogin('19981208777', '123456');
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'u-1' },
      data: expect.objectContaining({ company: '水发集团' }),
    }));
  });

  it('mobilePasswordLogin：仅 13368360619 且口令 123456；错口令 401；名单外拒绝', async () => {
    const { svc, verification } = makeService();
    await expect(svc.mobilePasswordLogin('13368360619', '123456')).resolves.toMatchObject({ role: 'admin' });
    await expect(svc.mobilePasswordLogin('13368360619', '000000')).rejects.toMatchObject({ response: { code: 'MOBILE_PASSWORD_MISMATCH' } });
    await expect(svc.mobilePasswordLogin('13800000000', '123456')).rejects.toMatchObject({ response: { code: 'MOBILE_PHONE_NOT_ALLOWED' } });
    await expect(svc.mobilePasswordLogin('19981208777', '123456')).rejects.toMatchObject({ response: { code: 'MOBILE_PHONE_NOT_ALLOWED' } });
    expect(verification.validateMobileLoginCode).not.toHaveBeenCalled();
  });
});
