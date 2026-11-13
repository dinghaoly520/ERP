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
    opts: {
      user?: { webSessionId: string | null } | null;
      userError?: Error;
      alive?: boolean | Error;
      withRegistry?: boolean;
    } = {},
  ) {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue(payload) };
    const prisma = {
      user: {
        findUnique: jest.fn().mockImplementation(() =>
          opts.userError
            ? Promise.reject(opts.userError)
            : Promise.resolve(opts.user === undefined ? null : opts.user),
        ),
      },
    };
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

  it('①c prisma 查询抛错（DB 瞬断）→ fail closed 拒连，不悬挂未认证连接、不上抛 unhandled rejection', async () => {
    // 评审实证（fix round 1）：@nestjs/websockets@11 经 .subscribe(args => handleConnection(...args))
    // 调用且无错误回调、返回 promise 被丢弃——findUnique 上抛 = socket 悬挂未认证 +
    // unhandled rejection（默认 Node 语义终止进程；DB 瞬断 + WS 自动重连 = API 崩溃向量）。
    const socket = makeSocket();
    const { gw, warnSpy } = makeGateway(
      { sub: 'u1', role: 'bid_expert', sid: 'sid-ok' },
      { userError: new Error('db down') },
    );
    await expect(gw.handleConnection(socket)).resolves.toBeUndefined(); // 不得 reject
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect((socket.data as any).userId).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('会话校验异常'));
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

describe('notifyDraftSaved 节流：前沿发射 + 尾沿补发（终审 Fix1）', () => {
  /** 直构网关：server 桩收 emit；节流窗缩至 50ms 用真实定时器实测尾沿 */
  function makeDraftGateway() {
    const gw = new BidGateway({} as any, {} as any, undefined);
    const emit = jest.fn();
    (gw as any).server = { to: jest.fn().mockReturnValue({ emit }) };
    (gw as any).DRAFT_SAVED_THROTTLE_MS = 50;
    return { gw, emit };
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('窗口内第二笔被压下 → 窗口期满补发一枚（末笔不丢，device 取被压下那笔）', async () => {
    const { gw, emit } = makeDraftGateway();
    gw.notifyDraftSaved('p1', 'e1', 'tablet'); // 前沿：立即发射
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][1]).toMatchObject({ projectId: 'p1', expertId: 'e1', device: 'tablet' });

    gw.notifyDraftSaved('p1', 'e1', 'desktop'); // 窗口内：压下，挂尾沿
    expect(emit).toHaveBeenCalledTimes(1);

    await sleep(130); // > 50ms 窗口
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[1][1]).toMatchObject({ projectId: 'p1', expertId: 'e1', device: 'desktop' });
  });

  it('窗口内仅一笔（无压下）→ 无尾沿补发', async () => {
    const { gw, emit } = makeDraftGateway();
    gw.notifyDraftSaved('p1', 'e1', 'tablet');
    await sleep(130);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('窗口内连续压下多笔 → 只补发一枚且 device 为最新一笔（latest wins）', async () => {
    const { gw, emit } = makeDraftGateway();
    gw.notifyDraftSaved('p1', 'e1', 'tablet'); // 前沿
    gw.notifyDraftSaved('p1', 'e1', 'desktop'); // 压下 → 挂尾沿(desktop)
    gw.notifyDraftSaved('p1', 'e1', 'tablet'); // 压下 → 清旧挂起、以本笔重挂(tablet)
    await sleep(130);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[1][1]).toMatchObject({ projectId: 'p1', expertId: 'e1', device: 'tablet' });
  });

  it('补发推进节流窗口：紧邻补发的新笔仍被压至下一窗口（≤1 发射/窗口语义保持）', async () => {
    const { gw, emit } = makeDraftGateway();
    gw.notifyDraftSaved('p1', 'e1', 'tablet'); // t≈0 前沿
    gw.notifyDraftSaved('p1', 'e1', 'desktop'); // 压下 → 尾沿 t≈50ms
    await sleep(60);
    expect(emit).toHaveBeenCalledTimes(2); // 尾沿已补发

    gw.notifyDraftSaved('p1', 'e1', 'tablet'); // 距尾沿 <50ms → 仍压下（窗口随补发推进，不连发）
    expect(emit).toHaveBeenCalledTimes(2);
    await sleep(80);
    expect(emit).toHaveBeenCalledTimes(3); // 下一窗口补发
    expect(emit.mock.calls[2][1]).toMatchObject({ device: 'tablet' });
  });

  it('窗口外新保存 → 立即发射（前沿行为不变）', async () => {
    const { gw, emit } = makeDraftGateway();
    gw.notifyDraftSaved('p1', 'e1', 'tablet');
    await sleep(130); // 窗口早已过
    gw.notifyDraftSaved('p1', 'e1', 'desktop');
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[1][1]).toMatchObject({ device: 'desktop' });
  });
});
