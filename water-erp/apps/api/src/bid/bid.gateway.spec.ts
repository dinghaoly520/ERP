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
  const prismaMock = { bidExpert: { findMany: jest.fn() } } as any;

  function makeGateway() {
    return new BidGateway({} as any, prismaMock);
  }

  it('专家 join:project → 进 project + experts 房，不进 host 房', async () => {
    const gw = makeGateway();
    const joined: string[] = [];
    const client = { id: 'sock-expert', data: { role: 'bid_expert', userId: 'u-exp' }, join: (r: string) => joined.push(r) } as any;
    const ack = await gw.handleJoinProject(client, 'p1');
    expect(ack).toEqual({ ok: true });
    expect(joined).toEqual(expect.arrayContaining(['project:p1', 'experts:p1']));
    expect(joined).not.toContain('host:p1');
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
