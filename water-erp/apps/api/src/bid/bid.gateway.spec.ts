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
  const prismaMock = { bidExpert: { findMany: jest.fn(), findFirst: jest.fn() } } as any;

  function makeGateway() {
    return new BidGateway({} as any, prismaMock);
  }

  it('已指派专家 join:project → 进 project + experts 房，不进 host 房', async () => {
    const gw = makeGateway();
    prismaMock.bidExpert.findFirst.mockResolvedValue({ id: 'be1', projectId: 'p1', userId: 'u-exp' });
    const joined: string[] = [];
    const client = { id: 'sock-expert', data: { role: 'bid_expert', userId: 'u-exp' }, join: (r: string) => joined.push(r) } as any;
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
    const client = { id: 'sock-declined', data: { role: 'bid_expert', userId: 'u-declined' }, join: (r: string) => joined.push(r) } as any;
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
  } as any;

  function makeGateway() {
    return new BidGateway({} as any, prismaMock);
  }
  function makeClient(data: Record<string, unknown>) {
    const joined: string[] = [];
    const left: string[] = [];
    const client = {
      id: `sock-${Math.random().toString(36).slice(2, 8)}`,
      data,
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
    return new BidGateway({} as any, {} as any);
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

    gw.notifyOpeningRecordUpdated('p1', { supplierId: 'sup-1', supplierName: '甲公司', recordId: 'r1', amount: 980000 });

    const targets = emitted.filter(e => e.event === BID_EVENT.OPENING_RECORD_UPDATED).map(e => e.room);
    expect(targets).toEqual(['project:p1']); // 房间级广播——房内全体投标人均可接收（成员门控在 join:project）
    expect(emitted[0].payload).toMatchObject({ projectId: 'p1', supplierId: 'sup-1', supplierName: '甲公司', recordId: 'r1', amount: 980000 });
    expect(emitted[0].payload).not.toHaveProperty('sealedPrice'); // 密封报价原文永不入广播
  });

  it('payload 不含异议过程与密封字段（公开口径仍脱敏）', () => {
    const gw = makeGateway();
    const emitted = captureServer(gw);
    gw.notifyOpeningRecordUpdated('p1', { supplierId: 'sup-1', supplierName: '甲公司', recordId: 'r1', amount: 980000 });
    const payload = emitted[0].payload;
    expect(payload).not.toHaveProperty('objectionReason');
    expect(payload).not.toHaveProperty('handleResult');
  });
});

describe('tokenFromHandshake 门户判定（多 cookie 共存）', () => {
  const WEB = 'token_web=web-jwt';
  const SUP = 'token_supplier=sup-jwt';
  const EXP = 'token_expert=exp-jwt';
  const mk = (cookie: string, headers: Record<string, string> = {}) =>
    ({ handshake: { headers: { cookie, ...headers } } }) as any;

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
});

describe('BidGateway join:project 认证兜底 + 角色白名单（C1/S1 回归防护）', () => {
  const prismaMock = {
    supplier: { findFirst: jest.fn() },
    bidSupplier: { findFirst: jest.fn(), update: jest.fn() },
    bidExpert: { findFirst: jest.fn() },
  } as any;

  function makeGateway() {
    return new BidGateway({} as any, prismaMock);
  }
  function makeClient(data: Record<string, unknown>) {
    const joined: string[] = [];
    const client = { id: 'sock-x', data, join: (r: string) => joined.push(r) } as any;
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

  it('C1：mall 等非白名单角色 join → FORBIDDEN，不进 project 房', async () => {
    const gw = makeGateway();
    for (const role of ['mall', 'internal_user']) {
      const { client, joined } = makeClient({ role, userId: `u-${role}` });
      expect(await gw.handleJoinProject(client, 'p1')).toEqual({ error: 'FORBIDDEN' });
      expect(joined).toEqual([]);
    }
  });

  it('S8 决策：procurement_staff 放行公开流（仅 project 房，不进 host 房）', async () => {
    const gw = makeGateway();
    const { client, joined } = makeClient({ role: 'procurement_staff', userId: 'u-staff' });
    expect(await gw.handleJoinProject(client, 'p1')).toEqual({ ok: true });
    expect(joined).toEqual(['project:p1']); // host:p1 不在其中——监督日志/异常/专家进度对其屏蔽
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
