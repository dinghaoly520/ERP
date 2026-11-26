import { BID_EVENT } from '@water-erp/shared';
import { BidGateway, canJoinHostRoom, SUPPLIER_BLOCKED_EVENTS, tokenFromHandshake } from './bid.gateway';

describe('BidGateway 门控纯函数', () => {
  it('host 房仅限 admin/bid_host/leader/staff', () => {
    expect(canJoinHostRoom('admin')).toBe(true);
    expect(canJoinHostRoom('bid_host')).toBe(true);
    expect(canJoinHostRoom('leader')).toBe(true);
    expect(canJoinHostRoom('staff')).toBe(true);
    expect(canJoinHostRoom('supplier')).toBe(false);
    expect(canJoinHostRoom('bid_expert')).toBe(false);
    expect(canJoinHostRoom(undefined)).toBe(false);
  });

  it('供应商屏蔽事件集：监督日志/异常/专家个体在场', () => {
    expect(SUPPLIER_BLOCKED_EVENTS.has(BID_EVENT.SUPERVISION_LOG)).toBe(true);
    expect(SUPPLIER_BLOCKED_EVENTS.has(BID_EVENT.ANOMALY_DETECTED)).toBe(true);
    expect(SUPPLIER_BLOCKED_EVENTS.has(BID_EVENT.EXPERT_PRESENCE)).toBe(true);
    expect(SUPPLIER_BLOCKED_EVENTS.has(BID_EVENT.STAGE_CHANGE)).toBe(false);
    expect(SUPPLIER_BLOCKED_EVENTS.has(BID_EVENT.DECRYPT_STATUS)).toBe(false);
    expect(SUPPLIER_BLOCKED_EVENTS.has(BID_EVENT.HALL_MESSAGE_NEW)).toBe(false);
  });
});

describe('BidGateway 专家聚合进度房（§4.3 回归防护）', () => {
  const prismaMock = {
    bidProject: { findUnique: jest.fn().mockResolvedValue(null) },
    user: { findUnique: jest.fn().mockResolvedValue(null) }, bidExpert: { findMany: jest.fn(), findFirst: jest.fn() } } as any;

  function makeGateway() {
    return new BidGateway({} as any, prismaMock);
  }

  it('已指派专家 join:project → 进 project + experts 房，不进 host 房', async () => {
    const gw = makeGateway();
    prismaMock.bidExpert.findFirst.mockResolvedValue({ id: 'be1', projectId: 'p1', userId: 'u-exp' });
    const joined: string[] = [];
    const client = { id: 'sock-expert', data: { role: 'bid_expert', userId: 'u-exp' }, connected: true, join: (r: string) => joined.push(r) } as any;
    const ack = await gw.handleJoinProject(client, 'p1');
    expect(ack).toEqual({ ok: true });
    expect(prismaMock.bidExpert.findFirst).toHaveBeenCalledWith({
      where: { projectId: 'p1', userId: 'u-exp', invitationStatus: { not: 'declined' } },
    });
    expect(joined).toEqual(['project:p1', 'experts:p1']);
  });

  it('已拒邀专家（invitationStatus=declined 被查询条件过滤）→ NOT_ASSIGNED_EXPERT', async () => {
    const gw = makeGateway();
    prismaMock.bidExpert.findFirst.mockResolvedValue(null); // declined 行被 { not: 'declined' } 条件排除
    const joined: string[] = [];
    const client = { id: 'sock-declined', data: { role: 'bid_expert', userId: 'u-declined' }, connected: true, join: (r: string) => joined.push(r) } as any;
    expect(await gw.handleJoinProject(client, 'p1')).toEqual({ error: 'NOT_ASSIGNED_EXPERT' });
    expect(joined).toEqual([]);
  });

  it('broadcastAggregatePresence 同时发射 host 房与 experts 房（供应商不可见）', async () => {
    const gw = makeGateway();
    prismaMock.bidExpert.findMany.mockResolvedValue([
      { signedIn: true, avoidanceConfirmed: true, reportConfirmed: false, progress: 50 },
      { signedIn: true, avoidanceConfirmed: true, reportConfirmed: true, progress: 100 },
    ]);
    const emitted: Array<{ room: string; event: string; payload: any }> = [];
    gw.server = { to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }) } as any;
    await gw.broadcastAggregatePresence('p1');
    const rooms = emitted.filter(e => e.event === BID_EVENT.EXPERT_PRESENCE_AGGREGATE).map(e => e.room);
    expect(rooms).toEqual(expect.arrayContaining(['host:p1', 'experts:p1']));
    expect(rooms).not.toContain('project:p1'); // 供应商在 project 房 → 不可见
    const payload = emitted[0].payload;
    expect(payload.totalExperts).toBe(2);
    expect(payload.averageProgressPercent).toBe(75);
  });
});

describe('BidGateway leave:project 清连接表 + 定向推送项目过滤（R8）', () => {
  const prismaMock = {
    supplier: { findFirst: jest.fn() },
    bidSupplier: { findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    bidExpert: { findFirst: jest.fn() },
    // P2-1：host 域隔离查询（join 前置 setup 走 host 分支）
    bidProject: { findUnique: jest.fn().mockResolvedValue(null) },
    user: { findUnique: jest.fn().mockResolvedValue(null) },
  } as any;

  function makeGateway() {
    return new BidGateway({} as any, prismaMock);
  }
  function makeClient(data: Record<string, unknown>) {
    const joined: string[] = [];
    const left: string[] = [];
    const client = {
      id: `sock-${Math.random().toString(36).slice(2, 8)}`,
      data, connected: true,
      join: (r: string) => joined.push(r),
      leave: (r: string) => left.push(r),
    } as any;
    return { client, joined, left };
  }
  /** 捕获 server.to(room).emit 调用（按 room 收集）。 */
  function captureServer(gw: BidGateway) {
    const emitted: Array<{ room: string; event: string; payload: any }> = [];
    gw.server = { to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }) } as any;
    return emitted;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.supplier.findFirst.mockResolvedValue({ id: 'sup-1' });
    prismaMock.bidSupplier.findFirst.mockResolvedValue({ id: 'bs1', supplierName: '测试供应商' });
    prismaMock.bidSupplier.update.mockResolvedValue({});
    prismaMock.bidSupplier.findMany.mockResolvedValue([]);
  });

  it('供应商 join 后 leave → 连接表清空、退三个房、刷新 presence', async () => {
    const gw = makeGateway();
    captureServer(gw);
    const presenceSpy = jest.spyOn(gw, 'broadcastHallPresence').mockResolvedValue(undefined);
    const { client, joined, left } = makeClient({ role: 'supplier', userId: 'u-sup' });

    const ack = await gw.handleJoinProject(client, 'p1');
    expect(ack).toEqual(expect.objectContaining({ ok: true }));
    expect(joined).toContain('project:p1');
    expect(gw.getOnlineSupplierIds('p1').has('sup-1')).toBe(true); // 在线基线

    gw.handleLeaveProject(client, 'p1');
    expect(left).toEqual(expect.arrayContaining(['project:p1', 'host:p1', 'experts:p1']));
    expect(gw.getOnlineSupplierIds('p1').size).toBe(0); // supplierSockets 已清空
    expect((gw as any).socketProjects.has(client.id)).toBe(false); // socketProjects 已删除
    expect(presenceSpy).toHaveBeenCalledWith('p1'); // 离场后广播在场名单
  });

  it('leave 后定向事件不再投递该 socket（私聊/确认/异议/处理四路）', async () => {
    const gw = makeGateway();
    const emitted = captureServer(gw);
    jest.spyOn(gw, 'broadcastHallPresence').mockResolvedValue(undefined);
    const { client } = makeClient({ role: 'supplier', userId: 'u-sup' });
    await gw.handleJoinProject(client, 'p1');
    gw.handleLeaveProject(client, 'p1');

    gw.notifyHallMessage('p1', { id: 'm1', projectId: 'p1', roomType: 'PRIVATE', supplierId: 'sup-1', supplierName: '测试供应商', senderId: 'h', senderRole: 'HOST', senderName: '主持', content: 'x', createdAt: new Date().toISOString(), timestamp: Date.now() } as any);
    gw.notifyOpeningConfirmed('p1', 'sup-1', { projectId: 'p1', supplierId: 'sup-1', supplierName: '测试供应商', timestamp: Date.now() });
    gw.notifyOpeningDisputed('p1', 'sup-1', { projectId: 'p1', supplierId: 'sup-1', supplierName: '测试供应商', reason: 'x', timestamp: Date.now() });
    gw.notifyOpeningDisputeResolved('p1', 'sup-1', { projectId: 'p1', supplierId: 'sup-1', supplierName: '测试供应商', recordId: 'r1', confirm: true, result: 'x', timestamp: Date.now() });

    expect(emitted.filter(e => e.room === client.id)).toEqual([]); // 该 socket 零接收
  });

  it('同一供应商跨项目双 tab：定向推送仅送达本项目的 socket', () => {
    const gw = makeGateway();
    const emitted = captureServer(gw);
    // 直接构造连接表（等价于两个 tab 分别 join p1/p2）
    (gw as any).supplierSockets.set('sup-1', new Set(['sock-p1', 'sock-p2']));
    (gw as any).socketProjects.set('sock-p1', 'p1');
    (gw as any).socketProjects.set('sock-p2', 'p2');

    gw.notifyHallMessage('p1', { id: 'm1', projectId: 'p1', roomType: 'PRIVATE', supplierId: 'sup-1', supplierName: '测试供应商', senderId: 'h', senderRole: 'HOST', senderName: '主持', content: '仅 p1', createdAt: new Date().toISOString(), timestamp: Date.now() } as any);
    const privateTargets = emitted.filter(e => e.event === BID_EVENT.HALL_MESSAGE_NEW).map(e => e.room);
    expect(privateTargets).toContain('sock-p1');
    expect(privateTargets).not.toContain('sock-p2'); // 跨项目 tab 不互收
    expect(privateTargets).toContain('host:p1'); // 主持房不受影响

    gw.notifyOpeningConfirmed('p1', 'sup-1', { projectId: 'p1', supplierId: 'sup-1', supplierName: '测试供应商', timestamp: Date.now() });
    const confirmedTargets = emitted.filter(e => e.event === BID_EVENT.OPENING_CONFIRMED).map(e => e.room);
    expect(confirmedTargets).toContain('sock-p1');
    expect(confirmedTargets).not.toContain('sock-p2');
  });

  it('非供应商 socket leave → 仅退房与清 socketProjects，不触发供应商连接表操作', async () => {
    const gw = makeGateway();
    captureServer(gw);
    const presenceSpy = jest.spyOn(gw, 'broadcastHallPresence').mockResolvedValue(undefined);
    const { client, left } = makeClient({ role: 'bid_host', userId: 'u-host' });
    await gw.handleJoinProject(client, 'p1');
    gw.handleLeaveProject(client, 'p1');
    expect(left).toEqual(expect.arrayContaining(['project:p1', 'host:p1']));
    expect((gw as any).socketProjects.has(client.id)).toBe(false);
    expect(presenceSpy).toHaveBeenCalledWith('p1');
  });

  it('M2：presence 在线列表按项目口径过滤——供应商仅连 p2 时不列入 p1 在场名单', async () => {
    const gw = makeGateway();
    const emitted = captureServer(gw);
    // sup-1 仅登记于 p2（跨项目 tab）；sup-2 登记于 p1
    (gw as any).supplierSockets.set('sup-1', new Set(['sock-p2']));
    (gw as any).socketProjects.set('sock-p2', 'p2');
    (gw as any).supplierSockets.set('sup-2', new Set(['sock-p1']));
    (gw as any).socketProjects.set('sock-p1', 'p1');
    prismaMock.bidSupplier.findMany.mockResolvedValue([
      { supplierId: 'sup-1', supplierName: '仅连 p2 的供应商', checkInAt: null },
      { supplierId: 'sup-2', supplierName: 'p1 在线供应商', checkInAt: null },
    ]);

    await gw.broadcastHallPresence('p1');
    const payload = emitted.find(e => e.event === BID_EVENT.HALL_PRESENCE_UPDATE)?.payload;
    const ids = payload.onlineSuppliers.map((s: any) => s.supplierId);
    expect(ids).toContain('sup-2');
    expect(ids).not.toContain('sup-1'); // 旧全局口径 bug：size>0 即误列在线
    expect(payload.onlineCount).toBe(1);
    expect(gw.getOnlineSupplierIds('p1').has('sup-1')).toBe(false); // 与 getOnlineSupplierIds 口径一致
  });

  it('M6：leave 载荷与登记项目不一致 → 连接表按登记（p2）清、两房都退、presence 广播登记项目', async () => {
    const gw = makeGateway();
    captureServer(gw);
    const presenceSpy = jest.spyOn(gw, 'broadcastHallPresence').mockResolvedValue(undefined);
    const { client, left } = makeClient({ role: 'supplier', userId: 'u-sup' });
    await gw.handleJoinProject(client, 'p2'); // 唯一登记项目 p2
    expect(gw.getOnlineSupplierIds('p2').has('sup-1')).toBe(true);

    gw.handleLeaveProject(client, 'p1'); // 恶意/异常载荷：声称离开 p1
    // 连接表清理以 socketProjects 登记为准：socket 登记于 p2 → 被清（不因载荷 p1 而漏清/误清）
    expect(gw.getOnlineSupplierIds('p2').size).toBe(0);
    expect((gw as any).socketProjects.has(client.id)).toBe(false);
    // 载荷房 + 登记房都退（去重）
    expect(left).toEqual(expect.arrayContaining(['project:p1', 'project:p2']));
    // presence 广播登记项目 p2（旧实现只刷载荷 p1 → p2 在场名单残留幽灵在线）
    expect(presenceSpy).toHaveBeenCalledWith('p2');
  });
});

describe('BidGateway 唱标事件公开广播（opening:record:updated 合规口径）', () => {
  function makeGateway() {
    return new BidGateway({} as any, { bidProject: { findUnique: jest.fn().mockResolvedValue(null) }, user: { findUnique: jest.fn().mockResolvedValue(null) } } as any);
  }
  function captureServer(gw: BidGateway) {
    const emitted: Array<{ room: string; event: string; payload: any }> = [];
    gw.server = { to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }) } as any;
    return emitted;
  }

  it('project 房广播——全体投标人公开表实时刷新触发器（电子招标投标办法第30条口径）', () => {
    const gw = makeGateway();
    const emitted = captureServer(gw);
    (gw as any).supplierSockets.set('sup-1', new Set(['sock-sup1']));
    (gw as any).supplierSockets.set('sup-2', new Set(['sock-sup2']));
    (gw as any).socketProjects.set('sock-sup1', 'p1');
    (gw as any).socketProjects.set('sock-sup2', 'p1');

    gw.notifyOpeningRecordUpdated('p1', { supplierId: 'sup-1', supplierName: '甲公司', recordId: 'r1' });

    const targets = emitted.filter(e => e.event === BID_EVENT.OPENING_RECORD_UPDATED).map(e => e.room);
    expect(targets).toEqual(['project:p1']); // 房间级广播——房内全体投标人均可接收（成员门控在 join:project）
    expect(emitted[0].payload).toMatchObject({ projectId: 'p1', supplierId: 'sup-1', supplierName: '甲公司', recordId: 'r1' });
    expect(emitted[0].payload).not.toHaveProperty('amount'); // X-P2-02：金额不入广播（万元裸数字易误读）
    expect(emitted[0].payload).not.toHaveProperty('sealedPrice'); // 密封报价原文永不入广播
  });

  it('payload 不含异议过程与密封字段（公开口径仍脱敏）', () => {
    const gw = makeGateway();
    const emitted = captureServer(gw);
    gw.notifyOpeningRecordUpdated('p1', { supplierId: 'sup-1', supplierName: '甲公司', recordId: 'r1' });
    const payload = emitted[0].payload;
    expect(payload).not.toHaveProperty('objectionReason');
    expect(payload).not.toHaveProperty('handleResult');
  });
});

describe('tokenFromHandshake 门户判定（多 cookie 共存）', () => {
  const WEB = 'token_web=web-jwt';
  const SUP = 'token_supplier=sup-jwt';
  const EXP = 'token_expert=exp-jwt';
  const mk = (cookie: string, headers: Record<string, string> = {}, query: Record<string, unknown> = {}) =>
    ({ handshake: { headers: { cookie, ...headers }, query } }) as any;

  it('X-Portal: supplier 时优先 token_supplier（即使 token_web 共存）', () => {
    expect(tokenFromHandshake(mk(`${WEB}; ${SUP}`, { 'x-portal': 'supplier' }))).toBe('sup-jwt');
  });

  it('Origin 端口 3004（供应商门户）时优先 token_supplier', () => {
    expect(tokenFromHandshake(mk(`${WEB}; ${SUP}`, { origin: 'http://localhost:3004' }))).toBe('sup-jwt');
  });

  it('Origin 端口 3020（supplier-portal-next 迁移版）时优先 token_supplier', () => {
    expect(tokenFromHandshake(mk(`${WEB}; ${SUP}`, { origin: 'http://localhost:3020' }))).toBe('sup-jwt');
  });

  it('Origin 端口 3006（专家门户）时优先 token_expert', () => {
    expect(tokenFromHandshake(mk(`${WEB}; ${EXP}`, { origin: 'http://localhost:3006' }))).toBe('exp-jwt');
  });

  it('无门户线索时保持旧优先级 token_web 优先', () => {
    expect(tokenFromHandshake(mk(`${WEB}; ${SUP}; ${EXP}`))).toBe('web-jwt');
  });

  it('供应商门户无 token_supplier 时不再回退 token_web（2026-08 安全加固）', () => {
    // 历史「软」回退 token_supplier → token_web → token 在 localhost 跨端口共享 cookie
    // 的场景下会让残留 token_web 的供应商浏览器被识别为主持人角色——虽 join:project
    // 房间隔离兜底，但纵深防御失效。各门户现严格只读对应命名空间的 cookie。
    expect(tokenFromHandshake(mk(WEB, { 'x-portal': 'supplier' }))).toBeUndefined();
  });

  it('专家门户无 token_expert 时不再回退 token_web', () => {
    expect(tokenFromHandshake(mk(WEB, { 'x-portal': 'expert' }))).toBeUndefined();
  });

  // ── 域名家族 Origin（无端口，2026-10-26 *.scsfjt.com 部署）：按子域反查门户 ──

  it('域名 Origin 按子域判门户——bid 读 token_bid、supplier/expert 各归各命名空间', () => {
    const BID = 'token_bid=bid-jwt';
    expect(tokenFromHandshake(mk(`${WEB}; ${BID}`, { origin: 'https://bid-ssyc.scsfjt.com' }))).toBe('bid-jwt');
    expect(tokenFromHandshake(mk(`${WEB}; ${SUP}`, { origin: 'https://supplier-ssyc.scsfjt.com' }))).toBe('sup-jwt');
    expect(tokenFromHandshake(mk(`${WEB}; ${EXP}`, { origin: 'https://expert-ssyc.scsfjt.com' }))).toBe('exp-jwt');
    expect(tokenFromHandshake(mk(WEB, { origin: 'https://procurement-ssyc.scsfjt.com' }))).toBe('web-jwt');
  });

  it('域名 Origin 非四门户（信息门户 ssyc 子域）→ 默认 web 口径（token_web 优先）', () => {
    expect(tokenFromHandshake(mk(`${WEB}; ${SUP}`, { origin: 'https://ssyc.scsfjt.com' }))).toBe('web-jwt');
  });

  it('域名家族 Origin 无对应 token 时不跨命名空间回退（纵深防御语义保持）', () => {
    expect(tokenFromHandshake(mk(WEB, { origin: 'https://supplier-ssyc.scsfjt.com' }))).toBeUndefined();
    expect(tokenFromHandshake(mk(WEB, { origin: 'https://bid-ssyc.scsfjt.com' }))).toBeUndefined();
  });

  // ── 同源反代（2026-11-03 gatewayWsUrl 域名模式 = 同源 /socket.io/ 经门户 nginx）：
  //    同源 GET 握手浏览器不带 Origin 头、XHR 轮询加不了自定义头 X-Portal——
  //    各门户客户端 io() 自报 query.portal 兜底（生产实录：主持人/供应商 WS 每秒被拒重连）。──

  it('query.portal=bid（无 Origin/无 X-Portal 的同源握手）→ 读 token_bid，不误读共存 token_web', () => {
    const BID = 'token_bid=bid-jwt';
    expect(tokenFromHandshake(mk(`${WEB}; ${BID}`, {}, { portal: 'bid' }))).toBe('bid-jwt');
  });

  it('query.portal=supplier / expert 各归各命名空间 cookie', () => {
    expect(tokenFromHandshake(mk(`${WEB}; ${SUP}`, {}, { portal: 'supplier' }))).toBe('sup-jwt');
    expect(tokenFromHandshake(mk(`${WEB}; ${EXP}`, {}, { portal: 'expert' }))).toBe('exp-jwt');
    expect(tokenFromHandshake(mk(WEB, {}, { portal: 'web' }))).toBe('web-jwt');
  });

  it('query.portal 非法值忽略 → 走原判定链（默认 token_web）', () => {
    expect(tokenFromHandshake(mk(`${WEB}; ${SUP}`, {}, { portal: 'attacker' }))).toBe('web-jwt');
    expect(tokenFromHandshake(mk(`${WEB}; ${SUP}`, {}, { portal: ['supplier', 'bid'] }))).toBe('sup-jwt');
  });

  it('X-Portal（nginx 注入的可信头）优先于 query.portal 自报', () => {
    expect(tokenFromHandshake(mk(`${WEB}; ${SUP}`, { 'x-portal': 'supplier' }, { portal: 'bid' }))).toBe('sup-jwt');
  });

  it('query.portal 指向命名空间无对应 cookie 时不跨命名空间回退', () => {
    expect(tokenFromHandshake(mk(WEB, {}, { portal: 'bid' }))).toBeUndefined();
    expect(tokenFromHandshake(mk(SUP, {}, { portal: 'expert' }))).toBeUndefined();
  });
});

describe('BidGateway join:project 认证兜底 + 角色白名单（C1/S1 回归防护）', () => {
  const prismaMock = {
    supplier: { findFirst: jest.fn() },
    bidSupplier: { findFirst: jest.fn(), update: jest.fn() },
    bidExpert: { findFirst: jest.fn() },
    // P2-1：host 域隔离查询（项目缺省 null → 放行入房）
    bidProject: { findUnique: jest.fn().mockResolvedValue(null) },
    user: { findUnique: jest.fn().mockResolvedValue(null) },
  } as any;

  function makeGateway() {
    return new BidGateway({} as any, prismaMock);
  }
  function makeClient(data: Record<string, unknown>) {
    const joined: string[] = [];
    const client = { id: 'sock-x', data, connected: true, join: (r: string) => joined.push(r) } as any;
    return { client, joined };
  }

  beforeEach(() => jest.clearAllMocks());

  it('C1：未认证 socket（无 role/userId）join → UNAUTHORIZED，不进任何房', async () => {
    const gw = makeGateway();
    const { client, joined } = makeClient({});
    expect(await gw.handleJoinProject(client, 'p1')).toEqual({ error: 'UNAUTHORIZED' });
    expect(joined).toEqual([]);
    const { client: c2, joined: j2 } = makeClient({ role: 'bid_host' }); // 有角色无 userId 也拒
    expect(await gw.handleJoinProject(c2, 'p1')).toEqual({ error: 'UNAUTHORIZED' });
    expect(j2).toEqual([]);
  });

  it('C1：非白名单角色 join → FORBIDDEN，不进 project 房', async () => {
    const gw = makeGateway();
    for (const role of ['internal_user']) {
      const { client, joined } = makeClient({ role, userId: `u-${role}` });
      expect(await gw.handleJoinProject(client, 'p1')).toEqual({ error: 'FORBIDDEN' });
      expect(joined).toEqual([]);
    }
  });

  it('host 角色 join → project + host 房', async () => {
    const gw = makeGateway();
    const { client, joined } = makeClient({ role: 'bid_host', userId: 'u-host' });
    expect(await gw.handleJoinProject(client, 'p1')).toEqual({ ok: true });
    expect(joined).toEqual(expect.arrayContaining(['project:p1', 'host:p1']));
  });

  it('S1：未指派专家 join → NOT_ASSIGNED_EXPERT，不进任何房', async () => {
    const gw = makeGateway();
    prismaMock.bidExpert.findFirst.mockResolvedValue(null);
    const { client, joined } = makeClient({ role: 'bid_expert', userId: 'u-exp' });
    expect(await gw.handleJoinProject(client, 'p1')).toEqual({ error: 'NOT_ASSIGNED_EXPERT' });
    expect(joined).toEqual([]);
    expect(prismaMock.bidExpert.findFirst).toHaveBeenCalledWith({
      where: { projectId: 'p1', userId: 'u-exp', invitationStatus: { not: 'declined' } },
    });
  });

  it('供应商分支双层门控保持：无档案 → SUPPLIER_PROFILE_NOT_FOUND；非成员 → NOT_PROJECT_MEMBER', async () => {
    const gw = makeGateway();
    prismaMock.supplier.findFirst.mockResolvedValue(null);
    const noProfile = makeClient({ role: 'supplier', userId: 'u-sup' });
    expect(await gw.handleJoinProject(noProfile.client, 'p1')).toEqual({ error: 'SUPPLIER_PROFILE_NOT_FOUND' });

    prismaMock.supplier.findFirst.mockResolvedValue({ id: 'sup-1' });
    prismaMock.bidSupplier.findFirst.mockResolvedValue(null);
    const nonMember = makeClient({ role: 'supplier', userId: 'u-sup' });
    expect(await gw.handleJoinProject(nonMember.client, 'p1')).toEqual({ error: 'NOT_PROJECT_MEMBER' });
    expect(nonMember.joined).toEqual([]);
  });
});

describe('BidGateway 澄清事件分级投递（P1-1：评标澄清不进 project 房，2026-09-09）', () => {
  function makeGateway() {
    return new BidGateway({} as any, { bidProject: { findUnique: jest.fn().mockResolvedValue(null) }, user: { findUnique: jest.fn().mockResolvedValue(null) } } as any);
  }
  function captureServer(gw: BidGateway) {
    const emitted: Array<{ room: string; event: string; payload: any }> = [];
    gw.server = { to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }) } as any;
    return emitted;
  }
  /** 两家供应商在线 p1：sup-1（当事）/ sup-2（竞争对手） */
  function seedSuppliers(gw: BidGateway) {
    (gw as any).supplierSockets.set('sup-1', new Set(['sock-sup1']));
    (gw as any).supplierSockets.set('sup-2', new Set(['sock-sup2']));
    (gw as any).socketProjects.set('sock-sup1', 'p1');
    (gw as any).socketProjects.set('sock-sup2', 'p1');
  }

  it('type=clarification（评标澄清，保密）→ host 房 + experts 房 + 当事供应商定向；竞争对手与 project 房不收', () => {
    const gw = makeGateway();
    const emitted = captureServer(gw);
    seedSuppliers(gw);
    gw.notifyClarificationCreated('p1', {
      id: 'c1', issuer: '主持人', issuerRole: 'host',
      supplierName: '甲公司', questionPreview: '请澄清技术参数偏离表第 3 项',
      type: 'clarification', supplierId: 'sup-1',
    });
    const rooms = emitted.filter(e => e.event === BID_EVENT.CLARIFICATION_CREATED).map(e => e.room);
    expect(rooms).toContain('host:p1');
    expect(rooms).toContain('experts:p1');
    expect(rooms).toContain('sock-sup1');       // 当事供应商定向（R8 同款 supplierSocketsIn）
    expect(rooms).not.toContain('sock-sup2');   // 竞争对手不收
    expect(rooms).not.toContain('project:p1');  // 全体投标人广播通道对保密澄清关闭
  });

  it('type=question（答疑，公开）→ project 房广播（既有公开口径回归）', () => {
    const gw = makeGateway();
    const emitted = captureServer(gw);
    seedSuppliers(gw);
    gw.notifyClarificationCreated('p1', {
      id: 'c2', issuer: '采购人', issuerRole: 'host',
      supplierName: '乙公司', questionPreview: '关于资格要求的统一答复',
      type: 'question', supplierId: 'sup-2',
    });
    const rooms = emitted.filter(e => e.event === BID_EVENT.CLARIFICATION_CREATED).map(e => e.room);
    expect(rooms).toEqual(['project:p1']);
  });

  it('type=clarification 但供应商离线/寻址失败 → 仅 host+experts，仍不进 project 房', () => {
    const gw = makeGateway();
    const emitted = captureServer(gw);
    gw.notifyClarificationCreated('p1', {
      id: 'c3', issuer: '主持人', issuerRole: 'host',
      supplierName: '丙公司', questionPreview: '请澄清',
      type: 'clarification', supplierId: 'sup-x',
    });
    const rooms = emitted.filter(e => e.event === BID_EVENT.CLARIFICATION_CREATED).map(e => e.room);
    expect(rooms.sort()).toEqual(['experts:p1', 'host:p1']);
  });
});


describe('BidGateway host 房公司隔离（P2-1，2026-09-09）——BidCompanyScopeGuard 的 WS 镜像', () => {
  const makeGw = (proj: any, me: any) => {
    const prisma: any = {
      bidProject: { findUnique: jest.fn().mockResolvedValue(proj) },
      user: { findUnique: jest.fn().mockResolvedValue(me) },
    };
    const gw = new BidGateway({} as any, prisma);
    return { gw, prisma };
  };
  const mkClient = (data: Record<string, unknown>, xPortal?: string) => {
    const joined: string[] = [];
    const client = {
      id: 'sock-x', data, connected: true,
      join: (r: string) => joined.push(r),
      handshake: { headers: xPortal ? { 'x-portal': xPortal } : {} },
    } as any;
    return { client, joined };
  };

  it('他司 staff（web 门户）→ COMPANY_SCOPE_FORBIDDEN，project/host 房均不进', async () => {
    const { gw } = makeGw({ companyId: 'co-B', assignedHostUserId: 'host-B' }, { companyId: 'co-A' });
    const { client, joined } = mkClient({ role: 'staff', userId: 'u-staff-A' }, 'web');
    expect(await gw.handleJoinProject(client, 'p1')).toEqual({ error: 'COMPANY_SCOPE_FORBIDDEN' });
    expect(joined).toEqual([]);
  });

  it('admin → 放行进 project + host 房（全量口径）', async () => {
    const { gw } = makeGw({ companyId: 'co-B', assignedHostUserId: null }, null);
    const { client, joined } = mkClient({ role: 'admin', userId: 'u-admin' }, 'web');
    expect(await gw.handleJoinProject(client, 'p1')).toEqual({ ok: true });
    expect(joined).toEqual(expect.arrayContaining(['project:p1', 'host:p1']));
  });

  it(':3007 被指派主持人（bid 门户 + assignedHostUserId 命中）→ 放行（现场执行权来自指派，含跨公司）', async () => {
    const { gw } = makeGw({ companyId: 'co-B', assignedHostUserId: 'u-host-X' }, { companyId: 'co-A' });
    const { client, joined } = mkClient({ role: 'bid_host', userId: 'u-host-X' }, 'bid');
    expect(await gw.handleJoinProject(client, 'p1')).toEqual({ ok: true });
    expect(joined).toEqual(expect.arrayContaining(['host:p1']));
  });

  it('本公司项目 → 放行（公司一致）', async () => {
    const { gw } = makeGw({ companyId: 'co-A', assignedHostUserId: null }, { companyId: 'co-A' });
    const { client, joined } = mkClient({ role: 'leader', userId: 'u-leader-A' }, 'web');
    expect(await gw.handleJoinProject(client, 'p1')).toEqual({ ok: true });
    expect(joined).toEqual(expect.arrayContaining(['project:p1', 'host:p1']));
  });
});

describe('BidGateway 专家连接表与复议定向推送（B1，2026-11-12）', () => {
  const prismaMock = {
    bidExpert: { findFirst: jest.fn() },
    bidProject: { findUnique: jest.fn().mockResolvedValue(null) },
    supplier: { findFirst: jest.fn() },
    bidSupplier: { findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    user: { findUnique: jest.fn().mockResolvedValue(null) },
  } as any;

  function makeGateway() {
    const gw = new BidGateway({} as any, prismaMock);
    jest.spyOn(gw, 'broadcastHallPresence').mockResolvedValue(undefined);
    jest.spyOn(gw, 'broadcastAggregatePresence').mockResolvedValue(undefined);
    return gw;
  }
  /** 专家 client：prisma 按需返回指派行（id 即 BidExpert.id） */
  function makeExpertClient(sockId: string, expertId: string, userId: string) {
    prismaMock.bidExpert.findFirst.mockResolvedValue({ id: expertId, userId });
    const joined: string[] = [];
    return {
      client: { id: sockId, data: { role: 'bid_expert', userId }, connected: true, join: (r: string) => joined.push(r), leave: jest.fn() } as any,
      joined,
    };
  }
  function captureServer(gw: BidGateway) {
    const emitted: Array<{ room: string; event: string; payload: any }> = [];
    gw.server = { to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }) } as any;
    return emitted;
  }
  const reviewPayload = {
    projectId: 'p1', invalidBidId: 'inv-1', supplierId: 'sup1', supplierName: '甲',
    scoreItemId: 'si1', scoreItemName: '资格性审查', category: 'QUALIFICATION' as const,
    failCount: 2, totalCount: 2, votes: [],
  };

  beforeEach(() => jest.clearAllMocks());

  it('join 登记 expertId → notifyLeadReviewSuggested 定向本项目 socket + host 房（跨项目 tab 不误投）', async () => {
    const gw = makeGateway();
    const emitted = captureServer(gw);
    const a = makeExpertClient('sock-p1', 'exp-lead', 'u-lead');
    const b = makeExpertClient('sock-p2', 'exp-lead', 'u-lead'); // 同专家另一项目
    expect(await gw.handleJoinProject(a.client, 'p1')).toEqual({ ok: true });
    expect(await gw.handleJoinProject(b.client, 'p2')).toEqual({ ok: true });

    gw.notifyLeadReviewSuggested('p1', 'exp-lead', reviewPayload);

    const rooms = emitted.map(e => e.room);
    expect(rooms).toContain('sock-p1');
    expect(rooms).not.toContain('sock-p2'); // supplierSocketsIn 同款项目过滤（R8 镜像）
    expect(rooms).toContain('host:p1');
    expect(emitted.every(e => e.event === BID_EVENT.LEAD_REVIEW_SUGGESTED)).toBe(true);
    expect(emitted[0].payload.invalidBidId).toBe('inv-1');
    expect(emitted[0].payload.timestamp).toBeTruthy();
  });

  it('notifyMotionCreated → experts 房广播（轻载荷）', () => {
    const gw = makeGateway();
    const emitted = captureServer(gw);
    gw.notifyMotionCreated('p1', { projectId: 'p1', motionId: 'm-1', type: 'invalid_bid', title: '废标复议表决' });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ room: 'experts:p1', event: BID_EVENT.MOTION_CREATED });
    expect(emitted[0].payload.motionId).toBe('m-1');
  });

  it('handleDisconnect 清理——断连后定向推送零 socket 送达（仅 host 房）', async () => {
    const gw = makeGateway();
    const emitted = captureServer(gw);
    const a = makeExpertClient('sock-x', 'exp-lead', 'u-lead');
    await gw.handleJoinProject(a.client, 'p1');

    gw.handleDisconnect(a.client);
    emitted.length = 0;
    gw.notifyLeadReviewSuggested('p1', 'exp-lead', reviewPayload);

    expect(emitted.map(e => e.room)).toEqual(['host:p1']); // socket 已清，防离场后仍收定向
  });

  it('leave:project 清理（以 socketProjects 登记为准）', async () => {
    const gw = makeGateway();
    const emitted = captureServer(gw);
    const a = makeExpertClient('sock-y', 'exp-lead', 'u-lead');
    await gw.handleJoinProject(a.client, 'p1');

    gw.handleLeaveProject(a.client, 'p1');
    emitted.length = 0;
    gw.notifyLeadReviewSuggested('p1', 'exp-lead', reviewPayload);

    expect(emitted.map(e => e.room)).toEqual(['host:p1']);
  });
});

// ── TAB-SYNC-02 P2-1：WS join 层 scoped pid 绑定闸（HTTP 面 PAIRING_PROJECT_MISMATCH 的镜像）──

describe('BidGateway join 层平板配对 pid 绑定（TAB-SYNC-02 P2-1）', () => {
  const prismaMock = {
    bidProject: { findUnique: jest.fn().mockResolvedValue(null) },
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    bidExpert: { findMany: jest.fn(), findFirst: jest.fn() },
  } as any;

  function makeGateway(registry?: any) {
    return new BidGateway({} as any, prismaMock, registry);
  }

  it('scoped（pairingPid=p1）join 非绑定项目 p2 → PAIRING_PROJECT_MISMATCH、不进任何房、不登记连接表', async () => {
    const gw = makeGateway();
    prismaMock.bidExpert.findFirst.mockResolvedValue({ id: 'be1', projectId: 'p2', userId: 'u-exp' });
    const joined: string[] = [];
    const client = { id: 'sock-tab', data: { role: 'bid_expert', userId: 'u-exp', pairingPid: 'p1' }, connected: true, join: (r: string) => joined.push(r) } as any;
    expect(await gw.handleJoinProject(client, 'p2')).toEqual({ error: 'PAIRING_PROJECT_MISMATCH' });
    expect(joined).toEqual([]);
    expect(gw['expertSockets'].get('be1')).toBeUndefined(); // 闸在指派查询后、登记前——不得留半登记
  });

  it('scoped join 绑定项目 p1（本人被指派、配对存活）→ 正常进房 ok', async () => {
    const gw = makeGateway({ isAlive: jest.fn().mockResolvedValue(true) });
    prismaMock.bidExpert.findFirst.mockResolvedValue({ id: 'be1', projectId: 'p1', userId: 'u-exp' });
    const joined: string[] = [];
    const client = { id: 'sock-tab2', data: { role: 'bid_expert', userId: 'u-exp', pairingPid: 'p1', pairingJti: 'j1' }, connected: true, join: (r: string) => joined.push(r) } as any;
    expect(await gw.handleJoinProject(client, 'p1')).toEqual({ ok: true });
    expect(joined).toEqual(['project:p1', 'experts:p1']);
  });

  it('全量令牌专家（无 pairingPid）join 任意被指派项目不受新闸影响', async () => {
    const gw = makeGateway();
    prismaMock.bidExpert.findFirst.mockResolvedValue({ id: 'be2', projectId: 'p9', userId: 'u-full' });
    const joined: string[] = [];
    const client = { id: 'sock-full', data: { role: 'bid_expert', userId: 'u-full' }, connected: true, join: (r: string) => joined.push(r) } as any;
    expect(await gw.handleJoinProject(client, 'p9')).toEqual({ ok: true });
    expect(joined).toEqual(['project:p9', 'experts:p9']);
  });
});

// ── TAB-SYNC-02 P2-2：吊销即时断连——广播 + scoped socket 踢除 ──

describe('BidGateway join 层配对存活复查（T8 审查 Important）', () => {
  const prismaMock = {
    bidProject: { findUnique: jest.fn().mockResolvedValue(null) },
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    bidExpert: { findMany: jest.fn(), findFirst: jest.fn().mockResolvedValue({ id: 'be1', projectId: 'p1', userId: 'u-exp' }) },
  } as any;

  function makeGateway(registry?: any) {
    return new BidGateway({} as any, prismaMock, registry);
  }

  it('scoped socket join 时配对已被吊销 → PAIRING_REVOKED，不进房不登记（leave→rejoin 回流封死）', async () => {
    const registry = { isAlive: jest.fn().mockResolvedValue(false) };
    const gw = makeGateway(registry);
    const joined: string[] = [];
    const client = { id: 'sock-t', data: { role: 'bid_expert', userId: 'u-exp', pairingPid: 'p1' }, connected: true, join: (r: string) => joined.push(r) } as any;
    expect(await gw.handleJoinProject(client, 'p1')).toEqual({ error: 'PAIRING_REVOKED' });
    expect(joined).toEqual([]);
    expect(gw['expertSockets'].get('be1')).toBeUndefined();
  });

  it('scoped socket join 时配对存活 → 正常进房', async () => {
    const registry = { isAlive: jest.fn().mockResolvedValue(true) };
    const gw = makeGateway(registry);
    const joined: string[] = [];
    const client = { id: 'sock-t2', data: { role: 'bid_expert', userId: 'u-exp', pairingPid: 'p1' }, connected: true, join: (r: string) => joined.push(r) } as any;
    expect(await gw.handleJoinProject(client, 'p1')).toEqual({ ok: true });
    expect(joined).toEqual(['project:p1', 'experts:p1']);
  });

  it('registry 缺失（fail closed）→ scoped join 拒绝；全量专家不受复查影响', async () => {
    const gw = makeGateway(undefined);
    const joined: string[] = [];
    const scoped = { id: 'sock-t3', data: { role: 'bid_expert', userId: 'u-exp', pairingPid: 'p1' }, connected: true, join: (r: string) => joined.push(r) } as any;
    expect(await gw.handleJoinProject(scoped, 'p1')).toEqual({ error: 'PAIRING_REVOKED' });
    const full = { id: 'sock-f', data: { role: 'bid_expert', userId: 'u-exp' }, connected: true, join: (r: string) => joined.push(r) } as any;
    expect(await gw.handleJoinProject(full, 'p1')).toEqual({ ok: true }); // 全量令牌无 pairingPid 不查
  });
});

describe('BidGateway 吊销即时断连（TAB-SYNC-02 P2-2）', () => {
  const prismaMock = {
    bidProject: { findUnique: jest.fn().mockResolvedValue(null) },
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    bidExpert: { findMany: jest.fn(), findFirst: jest.fn() },
  } as any;

  function makeGateway() {
    return new BidGateway({} as any, prismaMock);
  }

  it('notifyPairingRevoked → 向 project 房发 pairing:revoked {projectId, expertId}', () => {
    const gw = makeGateway();
    const emitted: Array<{ room: string; event: string; payload: any }> = [];
    gw.server = { to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }) } as any;
    gw.notifyPairingRevoked('p1', 'be1');
    // 终审 F2：改投 experts 房（§4.3 供应商不可见——project 房有投标供应商）
    expect(emitted).toEqual([{ room: 'experts:p1', event: 'pairing:revoked', payload: { projectId: 'p1', expertId: 'be1' } }]);
  });

  it('kickPairingSockets → 仅踢 pairingPid 有值的 scoped 连接，全量连接不动', () => {
    const gw = makeGateway();
    const scopedSock = { data: { pairingPid: 'p1' }, disconnect: jest.fn() };
    const fullSock = { data: {}, disconnect: jest.fn() };
    // 真实运行时形状：网关是 namespace:'bid' 命名空间网关，注入的 server 是 Namespace，
    // 其 .sockets 直接就是 Map<SocketId, Socket>（T8 审查 Critical：旧测试伪造
    // sockets.sockets.get 三层结构——镜像了错误心智模型，放过了 no-op 实现）
    const sockets = new Map([['sid-scoped', scopedSock], ['sid-full', fullSock]]);
    gw.server = { sockets } as any;
    gw['expertSockets'].set('be1', new Set(['sid-scoped', 'sid-full']));
    gw.kickPairingSockets('be1');
    expect(scopedSock.disconnect).toHaveBeenCalledWith(true);
    expect(fullSock.disconnect).not.toHaveBeenCalled();
  });

  it('kickPairingSockets → 无登记（空 Map/未 join）幂等不炸', () => {
    const gw = makeGateway();
    expect(() => gw.kickPairingSockets('nobody')).not.toThrow();
  });
});

// ── TAB-SYNC-02 P2-3：配对在线徽章——presence 跟踪与翻转广播 ──

describe('BidGateway 配对在线跟踪（TAB-SYNC-02 P2-3）', () => {
  const prismaMock = {
    bidProject: { findUnique: jest.fn().mockResolvedValue(null) },
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    bidExpert: { findMany: jest.fn(), findFirst: jest.fn() },
  } as any;

  function makeGateway(jwtPayload?: Record<string, unknown>) {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue(jwtPayload ?? {}) };
    return new BidGateway(jwt as any, prismaMock, { isAlive: jest.fn().mockResolvedValue(true) } as any);
  }

  it('isPairingOnline：无跟踪 → false；scoped 连接建立（handleConnection）→ true；断开 → false', async () => {
    const gw = makeGateway({ sub: 'u1', role: 'bid_expert', scope: 'tablet-pairing', jti: 'j1', pid: 'p1', eid: 'be1' });
    const emitted: Array<{ room: string; event: string; payload: any }> = [];
    gw.server = {
      to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
      sockets: new Map(),
    } as any;
    expect(gw.isPairingOnline('be1')).toBe(false);

    const sock = { id: 'sock-p1', data: {}, connected: true, handshake: { headers: { cookie: 'token_expert=exp-jwt', 'x-portal': 'expert' }, query: {} }, disconnect: jest.fn() } as any;
    await gw.handleConnection(sock);
    expect(gw.isPairingOnline('be1')).toBe(true);
    // 0→1 翻转广播 pairing:presence online=true 至项目房
    expect(emitted).toContainEqual({ room: 'experts:p1', event: 'pairing:presence', payload: { projectId: 'p1', expertId: 'be1', online: true } });

    gw.handleDisconnect(sock);
    expect(gw.isPairingOnline('be1')).toBe(false);
    expect(emitted).toContainEqual({ room: 'experts:p1', event: 'pairing:presence', payload: { projectId: 'p1', expertId: 'be1', online: false } });
  });

  it('同专家多 scoped 连接：任一在线即 online=true，末连接断开才翻 false（不抖动）', async () => {
    const gw = makeGateway({ sub: 'u1', role: 'bid_expert', scope: 'tablet-pairing', jti: 'j1', pid: 'p1', eid: 'be1' });
    const emitted: Array<any> = [];
    gw.server = {
      to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push(payload) }),
      sockets: new Map(),
    } as any;
    const mkSock = (id: string) => ({ id, data: {}, connected: true, handshake: { headers: { cookie: 'token_expert=exp-jwt', 'x-portal': 'expert' }, query: {} }, disconnect: jest.fn() } as any);
    const s1 = mkSock('sock-a');
    const s2 = mkSock('sock-b');
    await gw.handleConnection(s1);
    await gw.handleConnection(s2);
    expect(gw.isPairingOnline('be1')).toBe(true);
    gw.handleDisconnect(s1);
    expect(gw.isPairingOnline('be1')).toBe(true); // 仍在线——无翻转广播
    const onlineFlips = emitted.filter(p => p.online === false);
    expect(onlineFlips).toHaveLength(0);
    gw.handleDisconnect(s2);
    expect(gw.isPairingOnline('be1')).toBe(false);
    expect(emitted.filter(p => p.online === false)).toHaveLength(1);
  });
});

describe('握手鉴权与入会的时序（2026-11-25 入会竞态修复）', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const makeSocket = (cookie: string, portal: string) =>
    ({
      id: 'sock-race', data: {}, connected: true,
      handshake: { headers: { cookie, 'x-portal': portal }, query: {} },
      disconnect: jest.fn(), join: jest.fn(),
    }) as any;

  it('握手鉴权未完成时就到达的 join:project：等鉴权完成后再入会，不得判 UNAUTHORIZED', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockImplementation(async () => { await sleep(30); return { webSessionId: 'sid-1' }; }) },
      supplier: { findFirst: jest.fn().mockResolvedValue({ id: 'sup-1' }) },
      bidSupplier: {
        findFirst: jest.fn().mockResolvedValue({ id: 'bs-1', supplierName: '甲公司' }),
        findMany: jest.fn().mockResolvedValue([]), // 入会后的在场广播会查
        update: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u-sup', role: 'supplier', sid: 'sid-1' }) } as any;
    const gw = new BidGateway(jwt, prisma);
    const socket = makeSocket('token_supplier=sup-jwt', 'supplier');
    const authing = gw.handleConnection(socket);
    await new Promise((r) => setImmediate(r)); // 让出事件循环：真实客户端的入会消息总在之后一轮到达，此时查库对账还没结束
    const ack = gw.handleJoinProject(socket, 'p1');
    await authing;
    expect(await ack).toEqual({ ok: true, supplierId: 'sup-1', supplierName: '甲公司' });
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('握手鉴权失败（会话对账不匹配）：入会仍返回 UNAUTHORIZED，且连接被断开', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ webSessionId: 'sid-other' }) },
      supplier: { findFirst: jest.fn() },
      bidSupplier: { findFirst: jest.fn(), update: jest.fn() },
    } as any;
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u-sup', role: 'supplier', sid: 'sid-1' }) } as any;
    const gw = new BidGateway(jwt, prisma);
    const socket = makeSocket('token_supplier=sup-jwt', 'supplier');
    const authing = gw.handleConnection(socket);
    await new Promise((r) => setImmediate(r));
    const ack = gw.handleJoinProject(socket, 'p1');
    await authing;
    expect(await ack).toEqual({ error: 'UNAUTHORIZED' });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(prisma.supplier.findFirst).not.toHaveBeenCalled();
  });

  it('不带会话编号的主持人令牌：连上立即入会成功（行为不变）', async () => {
    const prisma = { user: { findUnique: jest.fn() }, bidProject: { findUnique: jest.fn().mockResolvedValue(null) } } as any;
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u-host', role: 'bid_host' }) } as any;
    const gw = new BidGateway(jwt, prisma);
    const socket = makeSocket('token_bid=host-jwt', 'bid');
    const authing = gw.handleConnection(socket);
    await new Promise((r) => setImmediate(r)); // 验签只占一个微任务：让出事件循环后身份已就位（主持人本就不受这个竞态影响）
    const ack = gw.handleJoinProject(socket, 'p1');
    await authing;
    expect(await ack).toEqual({ ok: true });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('握手鉴权以异常结束时：入会按身份缺失处理，不向外抛', async () => {
    const gw = new BidGateway({} as any, {} as any);
    const rejected = Promise.reject(new Error('boom'));
    rejected.catch(() => undefined); // 修复前不会被等待，先挂个处理函数避免未处理的拒绝干扰判定
    const client = { id: 'sock-x', data: { authReady: rejected }, connected: true, join: jest.fn() } as any;
    await expect(gw.handleJoinProject(client, 'p1')).resolves.toEqual({ error: 'UNAUTHORIZED' });
  });
});
// ── 2026-11-26 独立审查：处理途中客户端断开（M-1）与「入会等鉴权」的前提（M-3）──

describe('BidGateway 处理途中客户端断开（2026-11-26 独立审查 M-1）', () => {
  /** 可控的挂起查询：由测试决定何时放行 */
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }
  const flush = () => new Promise((r) => setImmediate(r));
  const makeSocket = (cookie: string, portal: string) =>
    ({
      id: 'sock-m1', data: {}, connected: true,
      handshake: { headers: { cookie, 'x-portal': portal }, query: {} },
      disconnect: jest.fn(), join: jest.fn(),
    }) as any;
  /** 客户端断开：socket.io 先触发 disconnect 回调（网关据此清理已登记的），随后把 connected 置 false */
  const drop = (gw: BidGateway, socket: any) => { gw.handleDisconnect(socket); socket.connected = false; };

  it('供应商：查档案途中断开 → 不登记在线、不进房', async () => {
    const profile = deferred<{ id: string }>();
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ webSessionId: 'sid-1' }) },
      supplier: { findFirst: jest.fn().mockReturnValue(profile.promise) },
      bidSupplier: {
        findFirst: jest.fn().mockResolvedValue({ id: 'bs-1', supplierName: '甲公司' }),
        update: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u-sup', role: 'supplier', sid: 'sid-1' }) } as any;
    const gw = new BidGateway(jwt, prisma);
    const socket = makeSocket('token_supplier=sup-jwt', 'supplier');
    await gw.handleConnection(socket);
    const ack = gw.handleJoinProject(socket, 'p1');
    await flush(); // 已进入查档案
    drop(gw, socket);
    profile.resolve({ id: 'sup-1' });
    expect(await ack).toEqual({ error: 'SOCKET_CLOSED' });
    expect(gw['supplierSockets'].size).toBe(0);
    expect(gw['socketProjects'].size).toBe(0);
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('供应商：登记后、进房前断开 → 断开回调已清登记，已断开的连接不再进房', async () => {
    const lastSeen = deferred<null>();
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ webSessionId: 'sid-1' }) },
      supplier: { findFirst: jest.fn().mockResolvedValue({ id: 'sup-1' }) },
      bidSupplier: {
        findFirst: jest.fn().mockResolvedValue({ id: 'bs-1', supplierName: '甲公司' }),
        update: jest.fn().mockReturnValue(lastSeen.promise),
      },
    } as any;
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u-sup', role: 'supplier', sid: 'sid-1' }) } as any;
    const gw = new BidGateway(jwt, prisma);
    const socket = makeSocket('token_supplier=sup-jwt', 'supplier');
    await gw.handleConnection(socket);
    const ack = gw.handleJoinProject(socket, 'p1');
    await flush(); // 登记已完成，正等最近在场时间落库
    expect(gw['supplierSockets'].size).toBe(1);
    drop(gw, socket);
    lastSeen.resolve(null);
    expect(await ack).toEqual({ error: 'SOCKET_CLOSED' });
    expect(gw['supplierSockets'].size).toBe(0);
    expect(gw['socketProjects'].size).toBe(0);
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('专家：查指派途中断开 → 不登记连接表、不进房', async () => {
    const assigned = deferred<{ id: string }>();
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ webSessionId: 'sid-1' }) },
      bidExpert: { findFirst: jest.fn().mockReturnValue(assigned.promise) },
    } as any;
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u-exp', role: 'bid_expert', sid: 'sid-1' }) } as any;
    const gw = new BidGateway(jwt, prisma);
    const socket = makeSocket('token_expert=exp-jwt', 'expert');
    await gw.handleConnection(socket);
    const ack = gw.handleJoinProject(socket, 'p1');
    await flush(); // 已进入查指派
    drop(gw, socket);
    assigned.resolve({ id: 'be-1' });
    expect(await ack).toEqual({ error: 'SOCKET_CLOSED' });
    expect(gw['expertSockets'].size).toBe(0);
    expect(gw['socketProjects'].size).toBe(0);
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('主持人：公司范围校验途中断开 → 不进房', async () => {
    const project = deferred<null>();
    const prisma = { bidProject: { findUnique: jest.fn().mockReturnValue(project.promise) } } as any;
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u-host', role: 'bid_host' }) } as any;
    const gw = new BidGateway(jwt, prisma);
    const socket = makeSocket('token_bid=host-jwt', 'bid');
    await gw.handleConnection(socket);
    const ack = gw.handleJoinProject(socket, 'p1');
    await flush(); // 已进入公司范围校验
    drop(gw, socket);
    project.resolve(null);
    expect(await ack).toEqual({ error: 'SOCKET_CLOSED' });
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('配对令牌：握手鉴权途中断开 → 不留下「配对在线」', async () => {
    const alive = deferred<boolean>();
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u-exp', role: 'bid_expert', scope: 'tablet-pairing', jti: 'j1', pid: 'p1', eid: 'be-1' }) } as any;
    const gw = new BidGateway(jwt, {} as any, { isAlive: jest.fn().mockReturnValue(alive.promise) } as any);
    gw.server = { to: () => ({ emit: jest.fn() }), sockets: new Map() } as any;
    const socket = makeSocket('token_expert=exp-jwt', 'expert');
    const authing = gw.handleConnection(socket);
    await flush(); // 正等 Redis 存活校验
    drop(gw, socket); // 此时还没登记配对在线，断开回调清不到什么
    alive.resolve(true);
    await authing;
    expect(gw.isPairingOnline('be-1')).toBe(false);
    expect(gw['pairingOnline'].size).toBe(0);
  });
});

describe('「入会等鉴权」的前提与覆盖面（2026-11-26 独立审查 M-3）', () => {
  it('handleConnection 返回时鉴权 promise 已挂在连接上——入会处理不必等它返回就能等它', () => {
    const jwt = { verifyAsync: jest.fn().mockReturnValue(new Promise(() => undefined)) } as any; // 验签一直不结束
    const gw = new BidGateway(jwt, {} as any);
    const socket = {
      id: 'sock-anchor', data: {},
      handshake: { headers: { cookie: 'token_bid=host-jwt', 'x-portal': 'bid' }, query: {} },
      disconnect: jest.fn(),
    } as any;
    gw.handleConnection(socket); // 不 await：框架同样不等
    expect(socket.data.authReady).toBeInstanceOf(Promise);
  });

  it('配对令牌的握手鉴权多一次 Redis 存活校验（放慢 30ms）：连上立即入会须等到校验结束并成功', async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ webSessionId: 'sid-1' }) },
      bidExpert: { findFirst: jest.fn().mockResolvedValue({ id: 'be-1' }), findMany: jest.fn().mockResolvedValue([]) },
    } as any;
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u-exp', role: 'bid_expert', sid: 'sid-1', scope: 'tablet-pairing', jti: 'j1', pid: 'p1', eid: 'be-1' }) } as any;
    const registry = { isAlive: jest.fn().mockImplementation(async () => { await sleep(30); return true; }) };
    const gw = new BidGateway(jwt, prisma, registry as any);
    gw.server = { to: () => ({ emit: jest.fn() }), sockets: new Map() } as any;
    const socket = {
      id: 'sock-slow', data: {}, connected: true,
      handshake: { headers: { cookie: 'token_expert=exp-jwt', 'x-portal': 'expert' }, query: {} },
      disconnect: jest.fn(), join: jest.fn(),
    } as any;
    const authing = gw.handleConnection(socket);
    await new Promise((r) => setImmediate(r));
    const ack = gw.handleJoinProject(socket, 'p1');
    await authing;
    expect(await ack).toEqual({ ok: true });
    expect(socket.join).toHaveBeenCalledWith('project:p1');
    expect(socket.disconnect).not.toHaveBeenCalled();
    expect(registry.isAlive).toHaveBeenCalledTimes(2); // 握手一次 + join 层复查一次
  });
});
