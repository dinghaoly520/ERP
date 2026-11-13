import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';
import { AuthController } from './auth.controller';
import { getJwtSecret } from '../common/jwt-secret.helper';
import type { PairingScope } from './tablet-pairing.scope';

/**
 * TAB-SYNC-01 Task 4：AuthGuard 配对令牌识别 + logout 登出分流。
 *
 * - scoped JWT（scope=tablet-pairing，Task 5 前无签发方）由测试用同一密钥自签；
 * - 登出分流的底线：平板受限令牌登出【绝不】触碰 User.webSessionId（sid 是桌面会话的）。
 */

/** 平板受限令牌全量声明（与 Task 5 签发口径一致；sid=桌面会话 ID） */
const SCOPED_CLAIMS = {
  sub: 'u1',
  username: '杨睿',
  role: 'bid_expert',
  sid: 'desk-sid-1',
  scope: 'tablet-pairing',
  pid: 'p1',
  eid: 'e1',
  jti: 'jti-1',
};

/** AuthGuard 复查用户行（isActive/isFrozen/tempExpert/sid 全通过——单测只关心配对面） */
const USER_ROW = {
  isActive: true,
  isFrozen: false,
  isTempExpert: false,
  webSessionId: 'desk-sid-1',
  passwordChangedAt: null as Date | null,
};

describe('AuthGuard × tablet-pairing（Task 4）', () => {
  const secret = getJwtSecret();
  const jwt = new JwtService({ secret });
  const reflector = { getAllAndOverride: () => undefined } as any;

  /** 直构守卫（无既有 auth.guard spec——本文件即首测；registry 可缺省；Error=reject 桩） */
  const makeGuard = (isAlive: boolean | undefined | Error) => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ ...USER_ROW }) },
      bidExpert: { count: jest.fn() },
    };
    const registry =
      isAlive === undefined
        ? undefined
        : {
            isAlive:
              isAlive instanceof Error
                ? jest.fn().mockRejectedValue(isAlive)
                : jest.fn().mockResolvedValue(isAlive),
          };
    return {
      guard: new AuthGuard(jwt, reflector, prisma as any, registry as any),
      registry,
    };
  };

  /** ExecutionContext 桩：X-Portal=expert + token_expert cookie（portal-cookie/端口校验全真） */
  const ctx = (token: string) => {
    const req: Record<string, unknown> = {
      headers: { 'x-portal': 'expert' },
      cookies: { token_expert: token },
    };
    return {
      req,
      execCtx: {
        switchToHttp: () => ({ getRequest: () => req }),
        getHandler: () => () => undefined,
        getClass: () => class {},
      } as any,
    };
  };

  it('scoped 令牌 + registry 存活 → 放行且 req.pairingScope 三字段正确', async () => {
    const { guard, registry } = makeGuard(true);
    const { req, execCtx } = ctx(jwt.sign({ ...SCOPED_CLAIMS }));

    await expect(guard.canActivate(execCtx)).resolves.toBe(true);
    expect(registry!.isAlive).toHaveBeenCalledWith('jti-1', 'u1');
    expect((req as { pairingScope?: PairingScope }).pairingScope).toEqual({
      projectId: 'p1',
      expertId: 'e1',
      pairingId: 'jti-1',
    });
  });

  it('registry 已吊销/过期 → 401 PAIRING_REVOKED（不挂 pairingScope）', async () => {
    const { guard, registry } = makeGuard(false);
    const { req, execCtx } = ctx(jwt.sign({ ...SCOPED_CLAIMS }));

    let err: unknown;
    try {
      await guard.canActivate(execCtx);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).getResponse()).toMatchObject({
      code: 'PAIRING_REVOKED',
      error: '配对已解除或过期，请在桌面端重新生成配对码',
    });
    expect(registry!.isAlive).toHaveBeenCalledWith('jti-1', 'u1');
    expect((req as { pairingScope?: PairingScope }).pairingScope).toBeUndefined();
  });

  it('非 scoped 令牌（桌面全量会话）→ registry 不被调用、不挂 pairingScope（纯增量佐证）', async () => {
    const { guard, registry } = makeGuard(true);
    const { req, execCtx } = ctx(
      jwt.sign({ sub: 'u1', username: '杨睿', role: 'bid_expert', sid: 'desk-sid-1' }),
    );

    await expect(guard.canActivate(execCtx)).resolves.toBe(true);
    expect(registry!.isAlive).not.toHaveBeenCalled();
    expect((req as { pairingScope?: PairingScope }).pairingScope).toBeUndefined();
  });

  it('registry 缺失（防御性直构）+ scoped 令牌 → fail closed 401 PAIRING_REVOKED', async () => {
    const { guard } = makeGuard(undefined);
    const { execCtx } = ctx(jwt.sign({ ...SCOPED_CLAIMS }));

    await expect(guard.canActivate(execCtx)).rejects.toThrow(UnauthorizedException);
  });

  it('fix #7：isAlive 抛 ServiceUnavailableException（Redis 故障）→ 503 原样透传，不得归一成裸 401', async () => {
    const { guard } = makeGuard(new ServiceUnavailableException('Redis 不可用'));
    const { execCtx } = ctx(jwt.sign({ ...SCOPED_CLAIMS }));

    let err: unknown;
    try {
      await guard.canActivate(execCtx);
    } catch (e) {
      err = e;
    }
    // 透传 503：归一成裸 401 会让平板端把服务故障误判为配对失效走重登回路（登录后闸4 仍 409 死循环）
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as ServiceUnavailableException).getStatus()).toBe(503);
    expect(err).not.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AuthController.logout 登出分流（Task 4）', () => {
  const secret = getJwtSecret();

  const makeController = (revokeResult: { userId: string; expertId: string; projectId: string } | null) => {
    const authService = { shouldRevokeSession: jest.fn().mockResolvedValue(true) };
    const prisma = {
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      user: { update: jest.fn().mockResolvedValue({}) },
      bidSupervisionLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const registry = {
      revoke: jest.fn().mockResolvedValue(revokeResult),
      revokeForUser: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new AuthController(
      authService as any,
      prisma as any,
      new JwtService({ secret }) as any,
      registry as any,
    );
    return { controller, authService, prisma, registry };
  };

  const reqStub = (user: Record<string, unknown>) =>
    ({
      headers: { 'x-portal': 'expert' },
      cookies: { token_expert: 'tok-1' },
      user,
    }) as any;

  it('scoped 分支：不写 webSessionId、吊销配对、写监督日志、清 cookie', async () => {
    const { controller, authService, prisma, registry } = makeController({
      userId: 'u1',
      expertId: 'e1',
      projectId: 'p1',
    });
    const res = { clearCookie: jest.fn() } as any;

    const ret = await controller.logout('u1', reqStub({ ...SCOPED_CLAIMS }), res);

    expect(ret).toEqual({ ok: true });
    // 底线：平板登出绝不误杀桌面会话（不比对 sid、不清 webSessionId）
    expect(authService.shouldRevokeSession).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(registry.revoke).toHaveBeenCalledWith('jti-1');
    expect(prisma.bidSupervisionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          projectId: 'p1',
          role: '评审专家',
          target: '杨睿',
          action: '平板解除配对',
          result: '平板端登出解除配对；桌面会话不受影响',
          riskFlag: '无',
        }),
      }),
    );
    // 清当前门户 cookie + 旧版 token
    expect(res.clearCookie).toHaveBeenCalledWith('token_expert', expect.anything());
    expect(res.clearCookie).toHaveBeenCalledWith('token', expect.anything());
  });

  it('scoped 分支：配对已被吊销（revoke → null）→ 不写监督日志、登出照常完成', async () => {
    const { controller, prisma, registry } = makeController(null);
    const res = { clearCookie: jest.fn() } as any;

    await controller.logout('u1', reqStub({ ...SCOPED_CLAIMS }), res);

    expect(registry.revoke).toHaveBeenCalledWith('jti-1');
    expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(res.clearCookie).toHaveBeenCalledWith('token_expert', expect.anything());
  });

  it('全量分支：原 sid 吊销行为不变 + 追加 revokeForUser 登出卫生', async () => {
    const { controller, authService, prisma, registry } = makeController(null);
    const res = { clearCookie: jest.fn() } as any;

    await controller.logout(
      'u1',
      reqStub({ sub: 'u1', username: '杨睿', role: 'bid_expert', sid: 'desk-sid-1' }),
      res,
    );

    // 既有行为：带 sid 会话 → 清 webSessionId
    expect(authService.shouldRevokeSession).toHaveBeenCalledWith('tok-1');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { webSessionId: null },
    });
    // Task 4 卫生清理：桌面全量登出吊销该用户全部平板配对
    expect(registry.revokeForUser).toHaveBeenCalledWith('u1');
    expect(registry.revoke).not.toHaveBeenCalled();
    expect(prisma.bidSupervisionLog.create).not.toHaveBeenCalled();
  });

  it('fix #14 角色闸：supplier 角色登出 → 不调 revokeForUser（不付全键域 SCAN，原 sid 吊销不变）', async () => {
    const { controller, authService, prisma, registry } = makeController(null);
    const res = { clearCookie: jest.fn() } as any;

    await controller.logout(
      'u-sup',
      reqStub({ sub: 'u-sup', username: '蜀通', role: 'supplier', sid: 'sid-sup-1' }),
      res,
    );

    // 既有行为不变：带 sid 会话 → 清 webSessionId、清 cookie
    expect(authService.shouldRevokeSession).toHaveBeenCalledWith('tok-1');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-sup' },
      data: { webSessionId: null },
    });
    expect(res.clearCookie).toHaveBeenCalled();
    // 只有 bid_expert 可能有配对——其余角色登出不得触发 revokeForUser 的全键域 SCAN
    expect(registry.revokeForUser).not.toHaveBeenCalled();
    expect(registry.revoke).not.toHaveBeenCalled();
  });

  it('fix #14 角色闸：staff 角色登出 → 同样不调 revokeForUser', async () => {
    const { controller, registry } = makeController(null);
    const res = { clearCookie: jest.fn() } as any;

    await controller.logout(
      'u-staff',
      reqStub({ sub: 'u-staff', username: 'staff-1', role: 'staff', sid: 'sid-staff-1' }),
      res,
    );

    expect(registry.revokeForUser).not.toHaveBeenCalled();
  });
});
