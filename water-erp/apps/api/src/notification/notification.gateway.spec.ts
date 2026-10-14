import { NotificationGateway } from './notification.gateway';

/**
 * X-P1-03（2026-09-29 审查修复）回归防护：通知网关握手必须按来源门户判别 cookie，
 * 不得回退串台——供应商页(:3004)不得以残留 token_web（staff 身份）加入 user:{staffId} 房间。
 * 修复方式：复用 bid.gateway 的 tokenFromHandshake（X-Portal/Origin 端口判别）。
 */

// token → JWT payload 映射（模拟 JwtService.verifyAsync）
const TOKENS: Record<string, { sub: string }> = {
  'jwt-supplier': { sub: 'u-supplier' },
  'jwt-expert': { sub: 'u-expert' },
  'jwt-bid-host': { sub: 'u-host' },
  'jwt-staff': { sub: 'u-staff' },
  // 'jwt-expired' 故意不登记：未映射 token 走 verifyAsync 的 ?? null 分支 = 验签失败
};

function makeGateway() {
  const jwt = { verifyAsync: jest.fn((t: string) => Promise.resolve(TOKENS[t] ?? null)) };
  const gw = new NotificationGateway(jwt as any, {} as any);
  const disconnected: boolean[] = [];
  const makeClient = (headers: Record<string, string>) => ({
    id: 'sock-1',
    handshake: { headers },
    data: {} as any,
    join: jest.fn(),
    disconnect: (v: boolean) => disconnected.push(v),
  }) as any;
  return { gw, makeClient, disconnected };
}

describe('NotificationGateway 握手门户判别（X-P1-03）', () => {
  it('供应商门户 origin(:3004)：token_supplier 优先，残留 token_web 不得串台', async () => {
    const { gw, makeClient } = makeGateway();
    const client = makeClient({
      origin: 'http://localhost:3004',
      cookie: 'token_web=jwt-staff; token_supplier=jwt-supplier',
    });
    await gw.handleConnection(client);
    expect(client.join).toHaveBeenCalledWith('user:u-supplier');
    expect(client.data.userId).toBe('u-supplier');
  });

  it('供应商门户 origin：仅残留 token_web（无本命名空间 cookie）→ 拒绝连接', async () => {
    const { gw, makeClient, disconnected } = makeGateway();
    const client = makeClient({
      origin: 'http://localhost:3004',
      cookie: 'token_web=jwt-staff',
    });
    await gw.handleConnection(client);
    expect(client.join).not.toHaveBeenCalled();
    expect(disconnected).toEqual([true]);
  });

  it('x-portal: bid 头 → 取 token_bid，token_web 残留不干扰', async () => {
    const { gw, makeClient } = makeGateway();
    const client = makeClient({
      'x-portal': 'bid',
      origin: 'http://localhost:3007',
      cookie: 'token_web=jwt-staff; token_bid=jwt-bid-host',
    });
    await gw.handleConnection(client);
    expect(client.join).toHaveBeenCalledWith('user:u-host');
  });

  it('web 门户 origin(:3005) → token_web', async () => {
    const { gw, makeClient } = makeGateway();
    const client = makeClient({
      origin: 'http://localhost:3005',
      cookie: 'token_web=jwt-staff; token_supplier=jwt-supplier',
    });
    await gw.handleConnection(client);
    expect(client.join).toHaveBeenCalledWith('user:u-staff');
  });

  it('本命名空间 token 失效但 cookie 残留（verify 失败）→ 拒绝连接（不回退他人 token）', async () => {
    const { gw, makeClient, disconnected } = makeGateway();
    const client = makeClient({
      origin: 'http://localhost:3004',
      cookie: 'token_web=jwt-staff; token_supplier=jwt-expired',
    });
    await gw.handleConnection(client);
    expect(client.join).not.toHaveBeenCalled();
    expect(disconnected).toEqual([true]);
  });

  it('无 cookie → 拒绝匿名连接', async () => {
    const { gw, makeClient, disconnected } = makeGateway();
    const client = makeClient({ origin: 'http://localhost:3004' });
    await gw.handleConnection(client);
    expect(disconnected).toEqual([true]);
  });
});

describe('NotificationGateway 会话轮换防护（2026-10-14 单设备互踢配套）', () => {
  /**
   * 互踢后旧 token 的 sid 与库中 webSessionId 不一致——REST 侧 AuthGuard 已 401
   * SESSION_REPLACED，WS 握手须同口径拒绝；否则被踢页签 REST 全挂却仍收推送弹窗，
   * 出现「通知弹窗可见、消息中心拉不到」悖论（2026-10-14 实录根因）。
   */
  const SID = 'sid-live-0000';

  function makeSidGateway(webSessionId: string | null, tokenPayload: Record<string, unknown> | null) {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue(tokenPayload) };
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ webSessionId }) } };
    const gw = new NotificationGateway(jwt as any, prisma as any);
    const disconnected: boolean[] = [];
    const client = ({
      id: 'sock-1',
      handshake: { headers: { origin: 'http://localhost:3004', cookie: 'token_supplier=jwt-x' } },
      data: {} as any,
      join: jest.fn(),
      disconnect: (v: boolean) => disconnected.push(v),
    }) as any;
    return { gw, client, disconnected };
  }

  it('带 sid 且与库中 webSessionId 一致 → 正常入房', async () => {
    const { gw, client } = makeSidGateway(SID, { sub: 'u-supplier', sid: SID });
    await gw.handleConnection(client);
    expect(client.join).toHaveBeenCalledWith('user:u-supplier');
  });

  it('带 sid 但已被轮换（与库中不一致）→ 拒绝连接不入房', async () => {
    const { gw, client, disconnected } = makeSidGateway('sid-new', { sub: 'u-supplier', sid: 'sid-old' });
    await gw.handleConnection(client);
    expect(client.join).not.toHaveBeenCalled();
    expect(disconnected).toEqual([true]);
  });

  it('带 sid 但用户已不存在/会话已清 → 拒绝连接', async () => {
    const { gw, client, disconnected } = makeSidGateway(null, { sub: 'u-gone', sid: SID });
    await gw.handleConnection(client);
    expect(client.join).not.toHaveBeenCalled();
    expect(disconnected).toEqual([true]);
  });

  it('无 sid（token_bid/token_mall 等不轮换命名空间）→ 不校验、正常入房', async () => {
    const { gw, client } = makeSidGateway('whatever', { sub: 'u-host' });
    await gw.handleConnection(client);
    expect(client.join).toHaveBeenCalledWith('user:u-host');
  });

  it('evictUser → 对 user:{id} 房间全体断开（会话轮换时驱逐旧订阅）', () => {
    const jwt = { verifyAsync: jest.fn() };
    const gw = new NotificationGateway(jwt as any, {} as any);
    const disconnectSockets = jest.fn();
    const inMock = jest.fn(() => ({ disconnectSockets }));
    (gw as any).server = { in: inMock };
    gw.evictUser('u-supplier');
    expect(inMock).toHaveBeenCalledWith('user:u-supplier');
    expect(disconnectSockets).toHaveBeenCalledWith(true);
  });

  it('evictUser 在 server 未就绪（测试环境）→ 静默跳过不抛错', () => {
    const jwt = { verifyAsync: jest.fn() };
    const gw = new NotificationGateway(jwt as any, {} as any);
    expect(() => gw.evictUser('u-supplier')).not.toThrow();
  });
});
