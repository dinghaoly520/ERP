import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { hashSync } from 'bcryptjs';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// socket 握手 + 登录链路较长，放宽全局超时
jest.setTimeout(30000);

/** 登录并返回单条 auth cookie（如 `token_supplier=xxx`）；X-Portal 决定 cookie 命名。 */
async function loginAs(app: INestApplication, username: string, password: string, portal: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login').set('X-Portal', portal).send({ username, password });
  const cookie = res.headers['set-cookie'];
  const first = Array.isArray(cookie) ? cookie[0] : cookie;
  return first ? String(first).split(';')[0] : '';
}

function connectBid(base: string, cookie: string): Socket {
  return io(`${base}/bid`, { withCredentials: true, extraHeaders: { Cookie: cookie }, reconnection: false, timeout: 8000 });
}

function joinAck(socket: Socket, projectId: string): Promise<any> {
  return new Promise(resolve => {
    socket.emit('join:project', projectId, (ack: any) => resolve(ack));
    setTimeout(() => resolve({ error: 'TIMEOUT' }), 5000);
  });
}

function onceEvent(socket: Socket, event: string, ms = 4000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting ${event}`)), ms);
    socket.once(event, (d: any) => { clearTimeout(t); resolve(d); });
  });
}

/** 种子 hero 项目（评标专家库 186 人中仅 5 人被指派到它，必然存在大量未指派专家）。 */
const HERO_PROJECT_ID = 'cmqhero-bid-proj01';

describe('Opening Hall (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let base: string;
  let hostCookie: string, sup1Cookie: string, sup2Cookie: string, expertCookie: string;
  let projectId: string, sup1Id: string, sup2Id: string;
  const sockets: Socket[] = [];
  const extraProjectIds: string[] = []; // 用例内临时创建、需在 afterAll 兜底清理的项目
  let nonMemberCookie: string;
  let nonMemberSupplierId: string, nonMemberUserId: string; // 临时「非参投供应商」，afterAll 清理
  let strayExpertCookie: string; // 未指派到 hero 项目的专家（S1 负用例）
  let strayExpertUserId: string | undefined; // 仅在兜底创建时有值，afterAll 清理

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.listen(0); // 随机端口，避免与 :4001 存活实例冲突
    base = await app.getUrl();
    prisma = app.get(PrismaService);

    hostCookie = await loginAs(app, '陈源远', '陈源远@2026', 'web');
    sup1Cookie = await loginAs(app, 'supplier1', 'supplier1@2026', 'supplier');
    sup2Cookie = await loginAs(app, 'huaxi', 'huaxi@2026', 'supplier');
    expertCookie = await loginAs(app, '刘苡池', 'expert@2026', 'expert');
    expect(hostCookie).toContain('token_web=');
    expect(sup1Cookie).toContain('token_supplier=');
    expect(sup2Cookie).toContain('token_supplier=');
    expect(expertCookie).toContain('token_expert=');

    // S1 负用例：找一个未指派到 hero 项目的 bid_expert 用户（186 人专家库中几乎必然存在）
    const heroAssignedIds = (
      await prisma.bidExpert.findMany({ where: { projectId: HERO_PROJECT_ID }, select: { userId: true } })
    ).map(r => r.userId);
    const stray = await prisma.user.findFirst({
      where: {
        role: 'bid_expert', isActive: true,
        ...(heroAssignedIds.length ? { id: { notIn: heroAssignedIds } } : {}),
      },
      select: { id: true, username: true },
    });
    if (stray) {
      strayExpertCookie = await loginAs(app, stray.username, 'expert@2026', 'expert');
    } else {
      // 兜底：临时创建 bid_expert 用户（密码 bcrypt hash 复用现有种子行，即 expert@2026 的 hash）
      const donor = await prisma.user.findFirst({ where: { role: 'bid_expert' }, select: { passwordHash: true } });
      const tsE = Date.now();
      const created = await prisma.user.create({
        data: {
          username: `e2e-stray-expert-${tsE}`, displayName: `E2E未指派专家-${tsE}`,
          role: 'bid_expert', isActive: true, passwordHash: donor!.passwordHash,
        },
      });
      strayExpertUserId = created.id;
      strayExpertCookie = await loginAs(app, created.username, 'expert@2026', 'expert');
    }
    expect(strayExpertCookie).toContain('token_expert=');

    // 临时「非参投供应商」：裸 User + Supplier 对（无 BidSupplier 行），用于成员门 E2E
    const ts0 = Date.now();
    const nmUser = await prisma.user.create({
      data: {
        username: `e2e-nonmember-${ts0}`, displayName: `E2E非参投-${ts0}`,
        role: 'supplier', isActive: true, passwordHash: hashSync('e2e@2026', 10),
      },
    });
    nonMemberUserId = nmUser.id;
    const nmSupplier = await prisma.supplier.create({
      data: {
        userId: nmUser.id, name: `E2E非参投供应商-${ts0}`, normalizedName: `E2E非参投供应商-${ts0}`,
        enterpriseType: '有限责任公司', legalPerson: '测试', registeredAddress: '成都', businessScope: '测试',
      },
    });
    nonMemberSupplierId = nmSupplier.id;
    nonMemberCookie = await loginAs(app, `e2e-nonmember-${ts0}`, 'e2e@2026', 'supplier');
    expect(nonMemberCookie).toContain('token_supplier=');

    const u1 = await prisma.user.findFirst({ where: { username: 'supplier1', role: 'supplier' } });
    const u2 = await prisma.user.findFirst({ where: { username: 'huaxi', role: 'supplier' } });
    const s1 = await prisma.supplier.findFirst({ where: { userId: u1!.id } });
    const s2 = await prisma.supplier.findFirst({ where: { userId: u2!.id } });
    sup1Id = s1!.id; sup2Id = s2!.id;

    const ts = Date.now();
    const proj = await prisma.bidProject.create({
      data: {
        projectCode: `E2E-OH-${ts}`, // @unique 必填，无默认值
        name: `开标大厅E2E-${ts}`,
        procurementMethod: '公开招标',
        stage: 'OPENING',
        openTime: new Date(),
        deadline: new Date(ts + 7200_000),
      },
    });
    projectId = proj.id;
    await prisma.bidOpeningSession.create({
      data: { projectId, host: '陈源远', supervisor: '监督', decryptWindowStart: new Date(), decryptWindowEnd: new Date(Date.now() + 3600_000) },
    });
    await prisma.bidSupplier.createMany({ data: [
      { projectId, supplierId: sup1Id, supplierName: s1!.name, decryptStatus: 'SUCCESS' },
      { projectId, supplierId: sup2Id, supplierName: s2!.name, decryptStatus: 'SUCCESS' },
    ]});
    const bs1 = await prisma.bidSupplier.findFirst({ where: { projectId, supplierId: sup1Id } });
    const bs2 = await prisma.bidSupplier.findFirst({ where: { projectId, supplierId: sup2Id } });
    await prisma.bidOpeningRecord.createMany({ data: [
      { projectId, supplierName: s1!.name, amount: '100', period: '90', qualityTarget: '合格', bondStatus: '已缴', decryptResult: '成功', confirmStatus: '待确认', bidSupplierId: bs1!.id },
      { projectId, supplierName: s2!.name, amount: '200', period: '90', qualityTarget: '合格', bondStatus: '已缴', decryptResult: '成功', confirmStatus: '待确认', bidSupplierId: bs2!.id },
    ]});
  });

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    if (projectId) {
      await prisma.openingHallReadCursor.deleteMany({ where: { projectId } }).catch(() => {});
      await prisma.openingHallMessage.deleteMany({ where: { projectId } }).catch(() => {});
      await prisma.bidSupervisionLog.deleteMany({ where: { projectId } }).catch(() => {});
      await prisma.bidOpeningRecord.deleteMany({ where: { projectId } }).catch(() => {});
      await prisma.bidSupplier.deleteMany({ where: { projectId } }).catch(() => {});
      await prisma.bidOpeningSession.deleteMany({ where: { projectId } }).catch(() => {});
      await prisma.notification.deleteMany({ where: { link: { contains: projectId } } }).catch(() => {});
      await prisma.bidProject.deleteMany({ where: { id: projectId } }).catch(() => {});
    }
    for (const id of extraProjectIds) {
      await prisma.bidProject.deleteMany({ where: { id } }).catch(() => {});
    }
    if (nonMemberSupplierId) await prisma.supplier.deleteMany({ where: { id: nonMemberSupplierId } }).catch(() => {});
    if (nonMemberUserId) await prisma.user.deleteMany({ where: { id: nonMemberUserId } }).catch(() => {});
    if (strayExpertUserId) await prisma.user.deleteMany({ where: { id: strayExpertUserId } }).catch(() => {});
    await app.close();
  });

  function track(s: Socket) { sockets.push(s); return s; }
  async function connected(s: Socket) {
    if (s.connected) return;
    return new Promise<void>((res, rej) => {
      s.on('connect', () => res());
      s.on('connect_error', rej);
    });
  }

  it('成员门：供应商可进自己项目，进他人项目被拒', async () => {
    const s = track(connectBid(base, sup1Cookie)); await connected(s);
    const ack = await joinAck(s, projectId);
    expect(ack).toEqual(expect.objectContaining({ ok: true, supplierId: sup1Id }));

    const ts = Date.now();
    const other = await prisma.bidProject.create({
      data: { projectCode: `E2E-OH-OTHER-${ts}`, name: `非参与项目-${ts}`, procurementMethod: '公开招标', stage: 'OPENING', openTime: new Date(), deadline: new Date(ts + 7200_000) },
    });
    extraProjectIds.push(other.id);
    const ack2 = await joinAck(s, other.id);
    expect(ack2).toEqual(expect.objectContaining({ error: 'NOT_PROJECT_MEMBER' }));
    await prisma.bidProject.delete({ where: { id: other.id } });
    extraProjectIds.splice(extraProjectIds.indexOf(other.id), 1);
  });

  it('签到 → 主持端与供应商端都收到 hall:checkin', async () => {
    const host = track(connectBid(base, hostCookie)); await connected(host); await joinAck(host, projectId);
    const sup = track(connectBid(base, sup1Cookie)); await connected(sup); await joinAck(sup, projectId);
    const pHost = onceEvent(host, 'hall:checkin');
    const pSup = onceEvent(sup, 'hall:checkin');
    await request(app.getHttpServer()).post(`/api/opening-hall/${projectId}/check-in`).set('Cookie', sup1Cookie).set('X-Portal', 'supplier').expect(201);
    const d = await pHost;
    expect(d.supplierId).toBe(sup1Id);
    expect(d.checkInAt).toBeTruthy();
    const ds = await pSup;
    expect(ds.supplierId).toBe(sup1Id);
  });

  it('公聊：主持发 → 两家供应商都收到', async () => {
    const s1 = track(connectBid(base, sup1Cookie)); await connected(s1); await joinAck(s1, projectId);
    const s2 = track(connectBid(base, sup2Cookie)); await connected(s2); await joinAck(s2, projectId);
    const p1 = onceEvent(s1, 'hall:message:new');
    const p2 = onceEvent(s2, 'hall:message:new');
    await request(app.getHttpServer()).post(`/api/opening-hall/${projectId}/messages`)
      .set('Cookie', hostCookie).set('X-Portal', 'web').send({ roomType: 'PUBLIC', content: '请各家准备解密' }).expect(201);
    const [d1, d2] = await Promise.all([p1, p2]);
    expect(d1.content).toBe('请各家准备解密');
    expect(d1.senderRole).toBe('HOST');
    expect(d2.content).toBe('请各家准备解密');
  });

  it('私聊隔离：主持→供应商1 的私聊，供应商2 收不到', async () => {
    const s1 = track(connectBid(base, sup1Cookie)); await connected(s1); await joinAck(s1, projectId);
    const s2 = track(connectBid(base, sup2Cookie)); await connected(s2); await joinAck(s2, projectId);
    const got1 = onceEvent(s1, 'hall:message:new');
    let leaked = false;
    s2.on('hall:message:new', (d: any) => { if (d.roomType === 'PRIVATE' && d.supplierId === sup1Id) leaked = true; });
    await request(app.getHttpServer()).post(`/api/opening-hall/${projectId}/messages`)
      .set('Cookie', hostCookie).set('X-Portal', 'web').send({ roomType: 'PRIVATE', supplierId: sup1Id, content: '仅供你方查看' }).expect(201);
    const d = await got1;
    expect(d.roomType).toBe('PRIVATE');
    expect(d.content).toBe('仅供你方查看');
    await new Promise(r => setTimeout(r, 500)); // 沉降窗口：确认供应商2 确实未收到
    expect(leaked).toBe(false);
  });

  it('供应商只能在自己私聊会话发言', async () => {
    await request(app.getHttpServer()).post(`/api/opening-hall/${projectId}/messages`)
      .set('Cookie', sup1Cookie).set('X-Portal', 'supplier').send({ roomType: 'PRIVATE', supplierId: sup2Id, content: 'x' }).expect(403);
  });

  it('MUTED：供应商禁言、主持仍可发；CLOSED：全员禁言', async () => {
    await request(app.getHttpServer()).patch(`/api/opening-hall/${projectId}/exchange-control`)
      .set('Cookie', hostCookie).set('X-Portal', 'web').send({ control: 'MUTED' }).expect(200);
    await request(app.getHttpServer()).post(`/api/opening-hall/${projectId}/messages`)
      .set('Cookie', sup1Cookie).set('X-Portal', 'supplier').send({ roomType: 'PUBLIC', content: 'x' }).expect(403);
    await request(app.getHttpServer()).post(`/api/opening-hall/${projectId}/messages`)
      .set('Cookie', hostCookie).set('X-Portal', 'web').send({ roomType: 'PUBLIC', content: '主持发言' }).expect(201);
    await request(app.getHttpServer()).patch(`/api/opening-hall/${projectId}/exchange-control`)
      .set('Cookie', hostCookie).set('X-Portal', 'web').send({ control: 'CLOSED' }).expect(200);
    await request(app.getHttpServer()).post(`/api/opening-hall/${projectId}/messages`)
      .set('Cookie', hostCookie).set('X-Portal', 'web').send({ roomType: 'PUBLIC', content: 'x' }).expect(403);
    await request(app.getHttpServer()).patch(`/api/opening-hall/${projectId}/exchange-control`)
      .set('Cookie', hostCookie).set('X-Portal', 'web').send({ control: 'OPEN' }).expect(200);
  });

  it('未读 + 读游标', async () => {
    const r1 = await request(app.getHttpServer()).get(`/api/opening-hall/${projectId}/unread`).set('Cookie', sup2Cookie).set('X-Portal', 'supplier').expect(200);
    expect(r1.body.public).toBeGreaterThan(0);
    await request(app.getHttpServer()).post(`/api/opening-hall/${projectId}/read`)
      .set('Cookie', sup2Cookie).set('X-Portal', 'supplier').send({ roomKey: 'public' }).expect(201);
    const r2 = await request(app.getHttpServer()).get(`/api/opening-hall/${projectId}/unread`).set('Cookie', sup2Cookie).set('X-Portal', 'supplier').expect(200);
    expect(r2.body.public).toBe(0);
  });

  it('历史分页：items 升序、nextCursor 可翻页', async () => {
    const r = await request(app.getHttpServer())
      .get(`/api/opening-hall/${projectId}/messages?roomType=PUBLIC&limit=2`).set('Cookie', hostCookie).set('X-Portal', 'web').expect(200);
    expect(r.body.items.length).toBeLessThanOrEqual(2);
    const times = r.body.items.map((m: any) => new Date(m.createdAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('供应商确认开标记录 → 主持端收到 opening:confirmed', async () => {
    const host = track(connectBid(base, hostCookie)); await connected(host); await joinAck(host, projectId);
    const p = onceEvent(host, 'opening:confirmed');
    await request(app.getHttpServer()).post(`/api/supplier-portal/bid-submissions/${projectId}/opening-confirm`)
      .set('Cookie', sup1Cookie).set('X-Portal', 'supplier').expect(201);
    const d = await p;
    expect(d.supplierId).toBe(sup1Id);
  });

  it('供应商提异议 → 主持端收到 opening:disputed；主持处理 → 供应商收到 dispute:resolved', async () => {
    const host = track(connectBid(base, hostCookie)); await connected(host); await joinAck(host, projectId);
    const sup = track(connectBid(base, sup1Cookie)); await connected(sup); await joinAck(sup, projectId);
    const pDisputed = onceEvent(host, 'opening:disputed');
    await request(app.getHttpServer()).post(`/api/supplier-portal/bid-submissions/${projectId}/opening-dispute`)
      .set('Cookie', sup1Cookie).set('X-Portal', 'supplier').send({ reason: '唱标金额有误' }).expect(201);
    const dd = await pDisputed;
    expect(dd.reason).toBe('唱标金额有误');

    const record = await prisma.bidOpeningRecord.findFirst({ where: { projectId, supplierName: dd.supplierName } });
    const pResolved = onceEvent(sup, 'opening:dispute:resolved');
    await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectId}/opening-records/${record!.id}/resolve-dispute`)
      .set('Cookie', hostCookie).set('X-Portal', 'web').send({ result: '复核无误', confirm: true }).expect(201);
    const rd = await pResolved;
    expect(rd.confirm).toBe(true);
  });

  it('授权收口：专家读私聊转录 → 403 HOST_ONLY（非主持非供应商角色）', async () => {
    await request(app.getHttpServer())
      .get(`/api/opening-hall/${projectId}/messages?roomType=PRIVATE&supplierId=${sup1Id}`)
      .set('Cookie', expertCookie).set('X-Portal', 'expert')
      .expect(403)
      .expect((res) => expect(res.body).toMatchObject({ code: 'HOST_ONLY' }));
    // 未读分布与在场名单同样拒绝
    await request(app.getHttpServer()).get(`/api/opening-hall/${projectId}/unread`)
      .set('Cookie', expertCookie).set('X-Portal', 'expert').expect(403);
    await request(app.getHttpServer()).get(`/api/opening-hall/${projectId}/presence`)
      .set('Cookie', expertCookie).set('X-Portal', 'expert').expect(403);
  });

  it('授权收口：非参投供应商发公聊 → NOT_PROJECT_MEMBER（不落库）', async () => {
    // 服务层抛 BadRequestException（与 checkIn 的 NOT_PROJECT_MEMBER 一致），故 HTTP 400
    await request(app.getHttpServer()).post(`/api/opening-hall/${projectId}/messages`)
      .set('Cookie', nonMemberCookie).set('X-Portal', 'supplier').send({ roomType: 'PUBLIC', content: '越权发言' })
      .expect(400)
      .expect((res) => expect(res.body).toMatchObject({ code: 'NOT_PROJECT_MEMBER' }));
    const leaked = await prisma.openingHallMessage.findFirst({ where: { projectId, content: '越权发言' } });
    expect(leaked).toBeNull();
  });

  it('阶段门：EVALUATING 阶段发消息 403', async () => {
    await prisma.bidProject.update({ where: { id: projectId }, data: { stage: 'EVALUATING' } });
    await request(app.getHttpServer()).post(`/api/opening-hall/${projectId}/messages`)
      .set('Cookie', hostCookie).set('X-Portal', 'web').send({ roomType: 'PUBLIC', content: 'x' }).expect(403);
    await prisma.bidProject.update({ where: { id: projectId }, data: { stage: 'OPENING' } });
  });

  it('C1 负用例：无 cookie 匿名 socket join → UNAUTHORIZED，收不到公聊广播', async () => {
    // 变体一：显式空 Cookie 头
    const anon1 = track(connectBid(base, '')); await connected(anon1);
    const ack1 = await joinAck(anon1, projectId);
    expect(ack1).toEqual({ error: 'UNAUTHORIZED' });
    // 变体二：完全不带 Cookie 头
    const anon2 = track(io(`${base}/bid`, { withCredentials: true, reconnection: false, timeout: 8000 }));
    await connected(anon2);
    const ack2 = await joinAck(anon2, projectId);
    expect(ack2).toEqual({ error: 'UNAUTHORIZED' });

    // 沉降窗口：主持端发公聊，两个匿名 socket 均不得收到 hall:message:new
    let leaked = 0;
    anon1.on('hall:message:new', () => leaked++);
    anon2.on('hall:message:new', () => leaked++);
    const host = track(connectBid(base, hostCookie)); await connected(host); await joinAck(host, projectId);
    await request(app.getHttpServer()).post(`/api/opening-hall/${projectId}/messages`)
      .set('Cookie', hostCookie).set('X-Portal', 'web').send({ roomType: 'PUBLIC', content: 'C1 匿名探针消息' }).expect(201);
    await new Promise(r => setTimeout(r, 600)); // 沉降窗口：确认匿名 socket 确实未收到
    expect(leaked).toBe(0);
  });

  it('S1 负用例：未指派专家跨项目 join hero → NOT_ASSIGNED_EXPERT', async () => {
    const s = track(connectBid(base, strayExpertCookie)); await connected(s);
    const ack = await joinAck(s, HERO_PROJECT_ID);
    expect(ack).toEqual({ error: 'NOT_ASSIGNED_EXPERT' });
  });

  it('S7 负用例：markRead 归属门 — supplier 写他人 roomKey 403；不存在项目 400', async () => {
    await request(app.getHttpServer()).post(`/api/opening-hall/${projectId}/read`)
      .set('Cookie', sup1Cookie).set('X-Portal', 'supplier').send({ roomKey: `supplier:${sup2Id}` })
      .expect(403)
      .expect((res) => expect(res.body).toMatchObject({ code: 'ROOM_KEY_FORBIDDEN' }));
    await request(app.getHttpServer()).post(`/api/opening-hall/nonexistent-project-id/read`)
      .set('Cookie', sup1Cookie).set('X-Portal', 'supplier').send({ roomKey: 'public' })
      .expect(400)
      .expect((res) => expect(res.body).toMatchObject({ code: 'NOT_FOUND' }));
    // 合法路径仍可用：supplier 写自身 roomKey
    await request(app.getHttpServer()).post(`/api/opening-hall/${projectId}/read`)
      .set('Cookie', sup1Cookie).set('X-Portal', 'supplier').send({ roomKey: `supplier:${sup1Id}` }).expect(201);
  });
});
