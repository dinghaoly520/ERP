import { ServiceUnavailableException } from '@nestjs/common';
import { BidGateway } from './bid.gateway';

/**
 * TAB-SYNC-01 Task 6：handleConnection 握手期补校验（spec §10 存量缺口——登出/会话轮换后
 * 旧设备 socket 此前可凭未过期 JWT 自由重连）。两道检查：
 * ① sid 一致：带 sid 的 token 与库中 User.webSessionId 对账（镜像 notification.gateway 先例）；
 * ② 配对存活：scope=tablet-pairing 受限令牌逐连接核对 Redis 登记（AuthGuard 逐请求口径的 WS 面）。
 */
describe('BidGateway handleConnection 握手校验（sid 一致 + 配对存活）', () => {
  /** 专家门户口径握手（x-portal: expert → tokenFromHandshake 读 token_expert） */
  function makeSocket() {
    return {
      id: 'sock-pair',
      handshake: {
        headers: { cookie: 'token_expert=exp-jwt', 'x-portal': 'expert' },
        query: {},
      },
      data: {} as Record<string, unknown>,
      disconnect: jest.fn(),
    } as any;
  }

  function makeGateway(
    payload: Record<string, unknown>,
    opts: { user?: { webSessionId: string | null } | null; alive?: boolean | Error; withRegistry?: boolean } = {},
  ) {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue(payload) };
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(opts.user === undefined ? null : opts.user) } };
    const registry = {
      isAlive: jest.fn().mockImplementation(() =>
        opts.alive instanceof Error ? Promise.reject(opts.alive) : Promise.resolve(opts.alive ?? false),
      ),
    };
    const gw = new BidGateway(
      jwt as any,
      prisma as any,
      (opts.withRegistry === false ? undefined : registry) as any,
    );
    const warnSpy = jest.spyOn((gw as any).logger, 'warn').mockImplementation(() => {});
    return { gw, jwt, prisma, registry, warnSpy };
  }

  const pairingPayload = {
    sub: 'u1', role: 'bid_expert',
    sid: 'sid-ok', scope: 'tablet-pairing', jti: 'pair-1', pid: 'p1', eid: 'be-1',
  };

  it('① 带 sid 且与库中 webSessionId 失配（登出/他处重登后旧 socket 重连）→ disconnect(true)，连接不建立', async () => {
    const socket = makeSocket();
    const { gw, prisma, warnSpy } = makeGateway(
      { sub: 'u1', role: 'bid_expert', sid: 'sid-old' },
      { user: { webSessionId: 'sid-new' } },
    );
    await gw.handleConnection(socket);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' }, select: { webSessionId: true } });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect((socket.data as any).userId).toBeUndefined(); // 未进入连接就位流程
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('sid 失配'));
  });

  it('①b 用户行缺失（findUnique → null）→ 同样视为失配拒连', async () => {
    const socket = makeSocket();
    const { gw } = makeGateway({ sub: 'u-gone', role: 'bid_expert', sid: 'sid-x' }, { user: null });
    await gw.handleConnection(socket);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect((socket.data as any).userId).toBeUndefined();
  });

  it('② scope=tablet-pairing 且配对登记已死（isAlive false）→ disconnect(true)', async () => {
    const socket = makeSocket();
    const { gw, registry, warnSpy } = makeGateway(pairingPayload, { user: { webSessionId: 'sid-ok' }, alive: false });
    await gw.handleConnection(socket);
    expect(registry.isAlive).toHaveBeenCalledWith('pair-1', 'u1');
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect((socket.data as any).userId).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('配对已解除或过期'));
  });

  it('③ 全匹配（sid 一致 + scoped 登记存活）→ 连接建立，socket.data 就位且不 disconnect', async () => {
    const socket = makeSocket();
    const { gw, registry } = makeGateway(pairingPayload, { user: { webSessionId: 'sid-ok' }, alive: true });
    await gw.handleConnection(socket);
    expect(registry.isAlive).toHaveBeenCalledWith('pair-1', 'u1');
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect((socket.data as any).userId).toBe('u1');
    expect((socket.data as any).role).toBe('bid_expert');
    expect((socket.data as any).isHost).toBe(false); // 专家不入 host 房
  });

  it('④ 无 sid 的 token（token_bid 等无 sid 命名空间）→ 不查 prisma/registry，照常连接（存量行为不变）', async () => {
    const socket = makeSocket();
    const { gw, prisma, registry } = makeGateway(
      { sub: 'u2', role: 'bid_host' },
      { user: { webSessionId: 'whatever' }, alive: false },
    );
    await gw.handleConnection(socket);
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(registry.isAlive).not.toHaveBeenCalled();
    expect((socket.data as any).userId).toBe('u2');
    expect((socket.data as any).isHost).toBe(true);
  });

  it('⑤ registry 抛错（Redis 故障 ServiceUnavailableException）→ fail closed 拒连，未校验配对 socket 不得放入', async () => {
    const socket = makeSocket();
    const { gw, warnSpy } = makeGateway(
      pairingPayload,
      { user: { webSessionId: 'sid-ok' }, alive: new ServiceUnavailableException('Redis 不可用') },
    );
    await gw.handleConnection(socket);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect((socket.data as any).userId).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('fail closed'));
  });

  it('⑤b registry 缺失（测试直构防御位）→ scoped token 同样 fail closed 拒连', async () => {
    const socket = makeSocket();
    const { gw, prisma } = makeGateway(pairingPayload, { user: { webSessionId: 'sid-ok' }, withRegistry: false });
    await gw.handleConnection(socket);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect((socket.data as any).userId).toBeUndefined();
    expect(prisma.user.findUnique).toHaveBeenCalled(); // sid 检查先行（sid 匹配通过后才到配对闸）
  });
});
