import { buildLogEntry } from './operation-log.interceptor';

const makeReq = (overrides: any = {}) =>
  ({
    method: 'POST',
    originalUrl: '/api/bid/score?x=1',
    path: '/api/bid/score',
    url: '/api/bid/score?x=1',
    headers: { 'user-agent': 'Mozilla/5.0', 'x-portal': 'expert' },
    body: { password: 'secret', score: 90 },
    socket: {},
    ...overrides,
  }) as any;

describe('buildLogEntry', () => {
  it('已登录：取 sub/username/role；body 脱敏', () => {
    const req = makeReq({ user: { sub: 'u1', username: '张三', role: 'bid_expert' } });
    const e = buildLogEntry(req, 200, 15, null, 4096);
    expect(e.userId).toBe('u1');
    expect(e.username).toBe('张三');
    expect(e.role).toBe('bid_expert');
    expect(e.portal).toBe('expert'); // X-Portal 头
    expect(e.method).toBe('POST');
    expect(e.path).toBe('/api/bid/score');
    expect(e.query).toBe('x=1');
    expect(e.body).toEqual({ password: '***', score: 90 });
    expect(e.statusCode).toBe(200);
    expect(e.durationMs).toBe(15);
    expect(e.userAgent).toBe('Mozilla/5.0');
    expect(e.error).toBeNull();
  });

  it('未登录：userId null、role anonymous', () => {
    const e = buildLogEntry(makeReq(), 401, 3, null, 4096);
    expect(e.userId).toBeNull();
    expect(e.role).toBe('anonymous');
    expect(e.statusCode).toBe(401);
  });

  it('异常：error 取 message', () => {
    const e = buildLogEntry(makeReq({ user: { sub: 'u1', username: 'a', role: 'admin' } }), 500, 8, new Error('boom'), 4096);
    expect(e.error).toBe('boom');
    expect(e.statusCode).toBe(500);
  });

  it('无 X-Portal/Referer 时 portal 为 null', () => {
    const req = makeReq({ headers: { 'user-agent': 'ua' }, user: { sub: 'u1', username: 'a', role: 'admin' } });
    expect(buildLogEntry(req, 200, 1, null, 4096).portal).toBeNull();
  });
});
