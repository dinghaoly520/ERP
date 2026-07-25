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

  it('Origin 端口 3006（专家门户）时优先 token_expert', () => {
    expect(tokenFromHandshake(mk(`${WEB}; ${EXP}`, { origin: 'http://localhost:3006' }))).toBe('exp-jwt');
  });

  it('无门户线索时保持旧优先级 token_web 优先', () => {
    expect(tokenFromHandshake(mk(`${WEB}; ${SUP}; ${EXP}`))).toBe('web-jwt');
  });

  it('供应商门户无 token_supplier 时回退 token_web', () => {
    expect(tokenFromHandshake(mk(WEB, { 'x-portal': 'supplier' }))).toBe('web-jwt');
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
