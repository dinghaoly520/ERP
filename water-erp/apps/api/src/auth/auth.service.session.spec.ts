import { AuthService } from './auth.service';

/**
 * X-P1-02（2026-09-29 审查修复）：登出吊销仅适用于带 sid 的单设备会话
 * （web/supplier/expert 命名空间）；token_bid 等无 sid 会话登出不得清 webSessionId——
 * 否则 :3007 登出会杀死同账号在 :3005 的活会话（跨命名空间互杀）。
 */
describe('AuthService.shouldRevokeSession（X-P1-02）', () => {
  const makeService = (verifyResult: Record<string, unknown> | null) => {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue(verifyResult) };
    return {
      svc: new AuthService({} as any, jwt as any, {} as any),
      jwt,
    };
  };

  it('带 sid 的合法 token（web/supplier/expert 单设备会话）→ true（登出应吊销）', async () => {
    const { svc } = makeService({ sub: 'u1', sid: 'a1bf8353-0000-0000-0000-000000000000' });
    await expect(svc.shouldRevokeSession('jwt-with-sid')).resolves.toBe(true);
  });

  it('无 sid 的 token（token_bid 主持人/管理员会话）→ false（登出不得清 webSessionId）', async () => {
    const { svc } = makeService({ sub: 'u1', role: 'bid_host' });
    await expect(svc.shouldRevokeSession('jwt-bid-no-sid')).resolves.toBe(false);
  });

  it('验签失败（过期/伪造）→ false（保守不吊销，仅清 cookie）', async () => {
    const { svc } = makeService(null);
    await expect(svc.shouldRevokeSession('jwt-bad')).resolves.toBe(false);
  });
});
