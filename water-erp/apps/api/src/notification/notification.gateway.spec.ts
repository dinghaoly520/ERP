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
  const gw = new NotificationGateway(jwt as any);
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
