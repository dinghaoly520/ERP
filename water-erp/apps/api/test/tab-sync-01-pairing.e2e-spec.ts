import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { hashSync } from 'bcryptjs';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ExpertPairingRegistry } from '../src/auth/expert-pairing.registry';

/**
 * TAB-SYNC-01 平板配对（不迁移）e2e — spec §12 十三项验收
 * spec: docs/superpowers/specs/2026-11-12-tab-sync-01-tablet-pairing-design.md
 *
 * 夹具完全自建（不依赖 seed）：专家用户 + EVALUATING 项目（roomCode 启用且专家行已验，
 * 覆盖 scenario 13 的真口令错误路径）+ 旁项目（pid 绑定负例）。signInMeta 故意置 null
 * → claim 必返 photoRequired=true（scenario 10 留档照全链前置）。
 *
 * WS 事件可直驱（socket.io-client 先例：opening-hall.e2e-spec.ts），scenario 11 用真握手
 * 验证；DRAFT_SAVED 广播的「对端拉取」环节在 scenario 2 以客户端实际使用的
 * GET score-draft 端点替代 WS 等待（合并正确性在服务端逐键裁决，广播只是触发器——
 * 与浏览器行为一致：onDraftSaved → 拉取合并）。
 *
 * 用例顺序有依赖（共享一对桌面/平板会话，destructive 场景排后；非破坏性用例复用同一次
 * 配对——claim 端点 @Throttle 10/min，全套共 5 次配对）：
 * 解绑/平板登出/桌面登出各一次后重新配对续测；桌面登出（杀桌面会话）排倒数第二，WS 收尾。
 */
describe('TAB-SYNC-01 平板配对 e2e（spec §12 1-13）', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let registry: ExpertPairingRegistry;
  let base: string; // WS 用（app.listen(0)）

  const PW = 'Pair@2026';
  const U = { expert: 'e2e-ts-expert' };
  const CODE_P1 = 'TS-P1-2026';
  const CODE_P2 = 'TS-P2-2026';
  const ROOM_CODE = 'TSROOM01';
  let expertUserId: string;
  let p1: string, p2: string; // 配对项目 / 旁项目（pid 绑定负例）
  let desktopCookie: string; // 桌面全量会话（token_expert=…，随登出/重登轮换）
  let tabletCookie = ''; // 当前活动配对的平板 scoped cookie（destructive 用例后由 pair() 轮换）
  const sockets: Socket[] = [];
  const photoAssetIds: string[] = []; // 留档照上传产生的 FileAsset（afterAll 清理）

  const expertHeaders = { 'X-Portal': 'expert' };

  function decodeJwt(token: string): Record<string, any> {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
  }

  /** 桌面全量登录（X-Portal: expert → 写 token_expert，rotatePortalSession 轮换 sid） */
  async function loginDesktop(): Promise<string> {
    const r = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Portal', 'expert')
      .send({ username: U.expert, password: PW })
      .expect(200);
    const c = r.headers['set-cookie'];
    const first = Array.isArray(c) ? c[0] : c;
    return String(first).split(';')[0];
  }

  /** 配对全链（桌面签发 90s 单次票 → 平板密码重证领取）→ 平板 scoped cookie（写入 tabletCookie） */
  async function pair(): Promise<Record<string, any>> {
    const t = await request(app.getHttpServer())
      .post(`/api/expert/projects/${p1}/pairing-ticket`)
      .set('Cookie', desktopCookie).set(expertHeaders)
      .expect(201);
    const c = await request(app.getHttpServer())
      .post('/api/auth/expert-pairing/claim')
      .send({ ticket: t.body.ticket, password: PW })
      .expect(200);
    const setCookie = Array.isArray(c.headers['set-cookie'])
      ? c.headers['set-cookie'].join('\n')
      : String(c.headers['set-cookie']);
    expect(setCookie).toContain('token_expert='); // 同命名空间 cookie（spec §5.2）
    tabletCookie = `token_expert=${c.body.access_token}`;
    return decodeJwt(c.body.access_token);
  }

  function track(s: Socket): Socket {
    sockets.push(s);
    return s;
  }
  const connected = (s: Socket) =>
    new Promise<void>((res, rej) => {
      if (s.connected) return res();
      s.on('connect', () => res());
      s.on('connect_error', rej);
    });
  /** 服务端握手期掐断（disconnect(true) / connect_error）均视为「拒连」；超时放行由断言侧兜底 fail */
  const serverKilled = (s: Socket) =>
    new Promise<void>((res) => {
      const t = setTimeout(() => res(), 6000);
      s.on('disconnect', () => { clearTimeout(t); res(); });
      s.on('connect_error', () => { clearTimeout(t); res(); });
    });

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    await app.listen(0); // 随机端口（WS 握手用；与常驻 :4001 不冲突）
    base = await app.getUrl();
    prisma = app.get(PrismaService);
    registry = app.get(ExpertPairingRegistry, { strict: false });

    // 防御性预清（上次崩溃残留会撞 projectCode 唯一键）
    await prisma.bidProject.deleteMany({ where: { projectCode: { in: [CODE_P1, CODE_P2] } } });
    await prisma.user.deleteMany({ where: { username: U.expert } }).catch(() => {});

    const expert = await prisma.user.create({
      data: {
        username: U.expert,
        displayName: '配对e2e专家',
        passwordHash: hashSync(PW, 10),
        role: 'bid_expert',
        isActive: true,
        expertProfile: { create: { specialty: '造价', availability: '可用', entryStatus: 'ACTIVE' } },
      },
    });
    expertUserId = expert.id;

    const past = new Date(Date.now() - 2 * 3600_000);
    // 配对项目：EVALUATING + 口令启用（专家行已验 roomVerifiedAt ≥ roomCodeAt——满足
    // pairing-ticket 前置 assertRoomUnlocked，同时保留 verify 的真错误码路径）
    const proj1 = await prisma.bidProject.create({
      data: {
        projectCode: CODE_P1, name: '配对e2e-主项目', procurementMethod: '公开招标',
        openTime: past, deadline: past, stage: 'EVALUATING',
        roomCode: ROOM_CODE, roomCodeAt: new Date(Date.now() - 3600_000),
      },
    });
    // 旁项目：同为 EVALUATING，专家亦被指派（桌面全量身份本有权限）——pid 绑定负例靶标
    const proj2 = await prisma.bidProject.create({
      data: {
        projectCode: CODE_P2, name: '配对e2e-旁项目', procurementMethod: '公开招标',
        openTime: past, deadline: past, stage: 'EVALUATING',
      },
    });
    p1 = proj1.id;
    p2 = proj2.id;

    // 核验三件套齐 + 已签到未确认报告（评标窗口开——闸4/票据前置）+ 口令已验
    await prisma.bidExpert.create({
      data: {
        projectId: p1, userId: expertUserId, expertName: U.expert, major: '造价',
        expertRole: '正选', invitationStatus: 'confirmed',
        signedIn: true, avoidanceConfirmed: true, aiConsentConfirmed: true,
        reportConfirmed: false, roomVerifiedAt: new Date(),
        // signInMeta 缺省即 null → claim 必 photoRequired=true（scenario 10）
      },
    });
    // 旁项目专家行：未签到（不开第二扇窗）——pid 负例与闸4 单窗口语义兼得
    await prisma.bidExpert.create({
      data: {
        projectId: p2, userId: expertUserId, expertName: U.expert, major: '造价',
        expertRole: '正选', invitationStatus: 'confirmed',
      },
    });

    desktopCookie = await loginDesktop();
    expect(desktopCookie).toContain('token_expert=');
  });

  afterAll(async () => {
    // Redis 配对登记清理（条目键值比对按 userId；票据键 90s/180s TTL 自然过期）
    await registry.revokeForUser(expertUserId).catch(() => {});
    for (const s of sockets) { try { s.disconnect(); } catch { /* already closed */ } }
    await prisma.fileAsset.deleteMany({ where: { id: { in: photoAssetIds } } }).catch(() => {});
    await prisma.bidProject.deleteMany({ where: { id: { in: [p1, p2] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: U.expert } }).catch(() => {});
    // 闸4 拒绝告警 / 口令错告警的快照文案清理（expert-room-window 同款先例）
    await prisma.notification.deleteMany({ where: { content: { contains: U.expert } } }).catch(() => {});
    await app.close();
  });

  /* ── §12.1 配对全链：登录 → 签发票 → 票态轮询 → claim → 受限 JWT → me ── */
  it('§12.1 配对全链：claim 签发受限 JWT（scope/pid/eid/sid=桌面会话），token_expert 可用，桌面 GET pairing 见设备', async () => {
    const desktopSid = decodeJwt(desktopCookie.split('=')[1]).sid;
    expect(desktopSid).toBeTruthy();

    const t = await request(app.getHttpServer())
      .post(`/api/expert/projects/${p1}/pairing-ticket`)
      .set('Cookie', desktopCookie).set(expertHeaders)
      .expect(201);
    expect(t.body.ticket).toBeTruthy();
    expect(t.body.expiresInSeconds).toBe(90);

    // 桌面 QR 弹窗轮询：pending → paired（@Public，配对成功后翻转）
    const pend = await request(app.getHttpServer())
      .get(`/api/expert/pairing-ticket/${t.body.ticketId}/status`)
      .expect(200);
    expect(pend.body.status).toBe('pending');

    const c = await request(app.getHttpServer())
      .post('/api/auth/expert-pairing/claim')
      .send({ ticket: t.body.ticket, password: PW })
      .expect(200);
    expect(c.body).toMatchObject({ role: 'bid_expert', username: U.expert, projectId: p1 });
    expect(c.body.photoRequired).toBe(true); // signInMeta 无照 → 严版强制补拍（§12.10 前置）
    tabletCookie = `token_expert=${c.body.access_token}`;

    const claims = decodeJwt(c.body.access_token);
    expect(claims.scope).toBe('tablet-pairing');
    expect(claims.pid).toBe(p1);
    expect(claims.eid).toBeTruthy();
    expect(claims.sid).toBe(desktopSid); // 携带桌面会话 sid：桌面轮换/登出即失配 401（§12.5 前提）
    expect(claims.jti).toBeTruthy();

    const paired = await request(app.getHttpServer())
      .get(`/api/expert/pairing-ticket/${t.body.ticketId}/status`)
      .expect(200);
    expect(paired.body.status).toBe('paired');

    // 平板 scoped cookie 经 /auth/me 可用（PairingScopeGuard 白名单）
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', tabletCookie).set(expertHeaders)
      .expect(200);

    // 桌面全量会话不受 claim 影响（反目标铁律：配对不得杀桌面）+ 已配对徽章数据源
    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', desktopCookie).set(expertHeaders)
      .expect(200);
    expect(me.body.username).toBe(U.expert);
    const pairing = await request(app.getHttpServer())
      .get(`/api/expert/projects/${p1}/pairing`)
      .set('Cookie', desktopCookie).set(expertHeaders)
      .expect(200);
    expect(pairing.body.device).not.toBeNull();
    expect(pairing.body.pairedAt).toBeTruthy();
  });

  /* ── §12.10 claim→留档照全链（scoped 态）：status → upload → pairing-photo → 进评审页 ── */
  it('§12.10 留档照全链在 scoped 态可走：pairing-photo-status → /upload(expert_signin_photo) → pairing-photo → GET project 200', async () => {
    const st = await request(app.getHttpServer())
      .get(`/api/expert/projects/${p1}/pairing-photo-status`)
      .set('Cookie', tabletCookie).set(expertHeaders)
      .expect(200);
    expect(st.body).toMatchObject({ photoRequired: true, exempted: false });

    // /upload 类目级白名单（uploadCategory=expert_signin_photo）
    const up = await request(app.getHttpServer())
      .post('/api/upload?category=expert_signin_photo')
      .set('Cookie', tabletCookie).set(expertHeaders)
      .attach('file', Buffer.from('%JPEG e2e pairing photo'), { filename: 'pair.jpg', contentType: 'image/jpeg' })
      .expect(201);
    expect(up.body.id).toBeTruthy();
    photoAssetIds.push(up.body.id);

    // 负例：同端点换非放行类目 → 403 PAIRING_SCOPE_FORBIDDEN（类目级而非整端点放行）
    await request(app.getHttpServer())
      .post('/api/upload?category=general')
      .set('Cookie', tabletCookie).set(expertHeaders)
      .attach('file', Buffer.from('x'), { filename: 'a.txt', contentType: 'text/plain' })
      .expect(403)
      .expect((r) => expect(r.body.code).toBe('PAIRING_SCOPE_FORBIDDEN'));

    const rec = await request(app.getHttpServer())
      .post(`/api/expert/projects/${p1}/pairing-photo`)
      .set('Cookie', tabletCookie).set(expertHeaders)
      .send({ photoAssetId: up.body.id, occlusion: 'passed' })
      .expect(201);
    expect(rec.body.ok).toBe(true);

    // 登记 → pending 清除；进评审页（GET project 200）
    const st2 = await request(app.getHttpServer())
      .get(`/api/expert/projects/${p1}/pairing-photo-status`)
      .set('Cookie', tabletCookie).set(expertHeaders)
      .expect(200);
    expect(st2.body.photoRequired).toBe(false);
    await request(app.getHttpServer())
      .get(`/api/expert/projects/${p1}`)
      .set('Cookie', tabletCookie).set(expertHeaders)
      .expect(200);
  });

  /* ── §12.2 同键再编辑回归（关键：旧「本设备槽优先」× 回声 = 静默分叉，修后逐键取新）
     §12.8 bug#98：配对态平板 + 全量态桌面同时在线各自可操作（并发读写交替） ── */
  it('§12.2/§12.8 同键交替再编辑：tablet 85 → desktop 见 85 → desktop 75 → tablet 见 75（非 85）→ tablet 90 → desktop 见 90；双端并发读写并存', async () => {
    const key = 'sup1:itemX';
    const T = Date.now();
    const draftOf = (score: number, at: number, by: string) => ({
      scores: { [key]: { score, reason: `e2e-${by}`, passed: true, savedAt: at } },
      savedAt: at,
    });

    // 平板写 X=85——伪报 device=desktop 仍须被收口进 tablet 槽（controller+service 双层强制）
    await request(app.getHttpServer())
      .post(`/api/expert/projects/${p1}/score-draft?device=desktop`)
      .set('Cookie', tabletCookie).set(expertHeaders)
      .send(draftOf(85, T + 1000, 'tablet'))
      .expect(201);
    // 服务层收口直查：tablet 槽有值、desktop 槽未被覆写（scoped 越槽写防御）
    const beRow = await prisma.bidExpert.findFirst({ where: { projectId: p1, userId: expertUserId } });
    const raw = (beRow?.scoreDraft ?? {}) as any;
    expect(raw?.tablet?.scores?.[key]?.score).toBe(85);
    expect(raw?.desktop?.scores?.[key]).toBeUndefined();
    // 桌面拉取见 85
    const d1 = await request(app.getHttpServer())
      .get(`/api/expert/projects/${p1}/score-draft?device=desktop`)
      .set('Cookie', desktopCookie).set(expertHeaders)
      .expect(200);
    expect(d1.body.scores[key].score).toBe(85);

    // bug#98 并发面：平板写 + 桌面读同时发起，两身份互不阻断
    const [w, r] = await Promise.all([
      request(app.getHttpServer())
        .post(`/api/expert/projects/${p1}/score-draft`)
        .set('Cookie', tabletCookie).set(expertHeaders)
        .send(draftOf(88, T + 1500, 'tablet-concurrent')),
      request(app.getHttpServer())
        .get(`/api/expert/projects/${p1}/score-draft?device=desktop`)
        .set('Cookie', desktopCookie).set(expertHeaders),
    ]);
    expect(w.status).toBe(201);
    expect(r.status).toBe(200);

    // 桌面写 X=75（savedAt 更新）
    await request(app.getHttpServer())
      .post(`/api/expert/projects/${p1}/score-draft?device=desktop`)
      .set('Cookie', desktopCookie).set(expertHeaders)
      .send(draftOf(75, T + 3000, 'desktop'))
      .expect(201);
    // 平板拉取见 75——旧语义此处回显本槽 85（分叉根因），逐键取新后必须穿透
    const t1 = await request(app.getHttpServer())
      .get(`/api/expert/projects/${p1}/score-draft?device=tablet`)
      .set('Cookie', tabletCookie).set(expertHeaders)
      .expect(200);
    expect(t1.body.scores[key].score).toBe(75);

    // 平板再写 X=90 → 桌面见 90
    await request(app.getHttpServer())
      .post(`/api/expert/projects/${p1}/score-draft?device=tablet`)
      .set('Cookie', tabletCookie).set(expertHeaders)
      .send(draftOf(90, T + 5000, 'tablet-again'))
      .expect(201);
    const d2 = await request(app.getHttpServer())
      .get(`/api/expert/projects/${p1}/score-draft?device=desktop`)
      .set('Cookie', desktopCookie).set(expertHeaders)
      .expect(200);
    expect(d2.body.scores[key].score).toBe(90);
  });

  /* ── §12.12 heartbeat 白名单：scoped 15s 心跳 200（吊销后 401 在 §12.4 覆盖） ── */
  it('§12.12 scoped GET /auth/heartbeat → 200（SessionWatchdog 心跳不被默认拒绝拦）', async () => {
    await request(app.getHttpServer())
      .get('/api/auth/heartbeat')
      .set('Cookie', tabletCookie).set(expertHeaders)
      .expect(200)
      .expect((r) => expect(r.body.ok).toBe(true));
  });

  /* ── §12.13 room-code/verify scoped 可达：错误口令 400 ROOM_CODE_INVALID（非 403——
     证明已过 PairingScopeGuard 白名单与 pid 绑定，落到业务校验） ── */
  it('§12.13 scoped room-code/verify：错口令 → 400 ROOM_CODE_INVALID（口令自验白名单，非 scope 拒）', async () => {
    const r = await request(app.getHttpServer())
      .post(`/api/expert/projects/${p1}/room-code/verify`)
      .set('Cookie', tabletCookie).set(expertHeaders)
      .send({ code: 'WRONGWRNG' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('ROOM_CODE_INVALID');
  });

  /* ── §12.3 平板写面默认拒绝：submitScores / score-review/verify / report/confirm ── */
  it('§12.3 scoped 调提交类端点 → 403 PAIRING_SCOPE_FORBIDDEN（submitScores / 核对 / 报告确认）', async () => {
    const segs = ['scores', 'suppliers/sup-x/score-review/verify', 'report/confirm'];
    for (const seg of segs) {
      const r = await request(app.getHttpServer())
        .post(`/api/expert/projects/${p1}/${seg}`)
        .set('Cookie', tabletCookie).set(expertHeaders)
        .send({});
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('PAIRING_SCOPE_FORBIDDEN');
      expect(r.body.error).toContain('桌面端');
    }
  });

  /* ── §12.9 pid 绑定：scoped 直调旁项目 → 403 PAIRING_PROJECT_MISMATCH；配对项目同端点 200；
     裸列表（无 pid 参数，天然豁免）服务层过滤为仅配对项目 ── */
  it('§12.9 pid 绑定：旁项目 403 PAIRING_PROJECT_MISMATCH；裸列表过滤为仅配对项目', async () => {
    // 桌面全量身份本有旁项目权限（专家行在册）——scoped 令牌仍被 guard 层拦（防线在 guard 非 UI）
    const other = await request(app.getHttpServer())
      .get(`/api/expert/projects/${p2}`)
      .set('Cookie', tabletCookie).set(expertHeaders);
    expect(other.status).toBe(403);
    expect(other.body.code).toBe('PAIRING_PROJECT_MISMATCH');

    // 配对项目同端点 200
    await request(app.getHttpServer())
      .get(`/api/expert/projects/${p1}`)
      .set('Cookie', tabletCookie).set(expertHeaders)
      .expect(200);

    // 裸列表：本人两项目在册，scoped 只见配对项目（listProjects 服务层过滤）
    const list = await request(app.getHttpServer())
      .get('/api/expert/projects')
      .set('Cookie', tabletCookie).set(expertHeaders)
      .expect(200);
    const ids = (list.body as any[]).map((x) => x.project?.id ?? x.projectId).filter(Boolean);
    expect(ids).toEqual([p1]);
  });

  /* ── §12.4 桌面解绑 → 平板下一请求 401 PAIRING_REVOKED（吊销即时生效，不等 12h JWT） ── */
  it('§12.4 桌面 DELETE pairing → 平板 401 PAIRING_REVOKED；桌面会话不受影响；再配对可恢复', async () => {
    const del = await request(app.getHttpServer())
      .delete(`/api/expert/projects/${p1}/pairing`)
      .set('Cookie', desktopCookie).set(expertHeaders)
      .expect(200);
    expect(del.body.ok).toBe(true);

    const after = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', tabletCookie).set(expertHeaders);
    expect(after.status).toBe(401);
    expect(after.body.code).toBe('PAIRING_REVOKED');
    expect(after.body.error).toContain('配对已解除');

    // 桌面不受影响 + 徽章数据源回落未配对态
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', desktopCookie).set(expertHeaders)
      .expect(200);
    const pairing = await request(app.getHttpServer())
      .get(`/api/expert/projects/${p1}/pairing`)
      .set('Cookie', desktopCookie).set(expertHeaders)
      .expect(200);
    expect(pairing.body).toMatchObject({ device: null, pairedAt: null });

    // 换机重配对（现场常见：解绑→重新出码）
    await pair();
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', tabletCookie).set(expertHeaders)
      .expect(200);
  });

  /* ── §12.7 闸4 不变：窗口内第三方全量登录 → 409 ACCOUNT_EVALUATING；
     被拒登录不得影响当前桌面会话（乱序检查前置） ── */
  it('§12.7 闸4：窗口开 + 活动会话 → 新全量登录 409 ACCOUNT_EVALUATING（配对引导文案）；桌面会话存活', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Portal', 'expert')
      .send({ username: U.expert, password: PW });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('ACCOUNT_EVALUATING');
    expect(r.body.error).toContain('配对打分平板'); // 闸4 文案增补配对引导（spec §7）

    // 拒绝不轮换会话——桌面仍在
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', desktopCookie).set(expertHeaders)
      .expect(200);
  });

  /* ── §12.6 平板登出 → 桌面会话仍活（反误杀回归：登出分流只吊销配对，不清 webSessionId） ── */
  it('§12.6 平板 logout → 桌面 /auth/me 仍 200；平板令牌随之 401 PAIRING_REVOKED', async () => {
    await pair();
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', tabletCookie).set(expertHeaders)
      .expect(200);

    // 反误杀核心断言：配对令牌 sid=桌面会话，登出分流不清 webSessionId
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', desktopCookie).set(expertHeaders)
      .expect(200);

    // 平板自身令牌：配对键已删 → 401 PAIRING_REVOKED
    const t = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', tabletCookie).set(expertHeaders);
    expect(t.status).toBe(401);
    expect(t.body.code).toBe('PAIRING_REVOKED');
  });

  /* ── §12.5 桌面登出 → 平板 401 SESSION_REPLACED（sid 失配：webSessionId 已清空） ── */
  it('§12.5 桌面 logout → 平板下一请求 401 SESSION_REPLACED（「登录已失效」路径）', async () => {
    await pair();
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', desktopCookie).set(expertHeaders)
      .expect(200);

    const t = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', tabletCookie).set(expertHeaders);
    expect(t.status).toBe(401);
    expect(t.body.code).toBe('SESSION_REPLACED');
    expect(t.body.error).toBe('登录已失效，请重新登录'); // webSessionId 已清空 ≠ 被顶
  });

  /* ── §12.11 WS 握手（真 socket.io-client，先例 opening-hall.e2e-spec.ts）：
     ① 配对态平板 socket 可连可入房；② 解绑后重连被拒（配对登记存活校验）；
     ③ 桌面登出后旧桌面 token 重连被拒（sid 一致校验——连带修复的存量缺口） ── */
  it('§12.11 WS 握手：平板可连/可入房；解绑后重连拒；桌面登出后旧 token 重连拒', async () => {
    // §12.5 已登出桌面——重建会话再配对
    desktopCookie = await loginDesktop();
    await pair();
    const openSocket = (cookie: string) =>
      track(io(`${base}/bid`, {
        withCredentials: true,
        extraHeaders: { Cookie: cookie, 'X-Portal': 'expert' }, // Node client 无 Origin——显式门户自报
        reconnection: false,
        timeout: 8000,
      }));

    // ① 平板 scoped socket：握手通过（sid 对账 + 配对存活）→ join:project 专家房 ok
    const tab = openSocket(tabletCookie);
    await connected(tab);
    const joinAck = new Promise<any>((resolve) => {
      tab.emit('join:project', p1, (ack: any) => resolve(ack));
      setTimeout(() => resolve({ error: 'TIMEOUT' }), 5000);
    });
    expect(await joinAck).toEqual(expect.objectContaining({ ok: true }));
    tab.disconnect();

    // 桌面全量 socket 亦可连（双 socket 并存——evictUser 仅全量登录触发，配对不轮换不驱逐）
    const desk = openSocket(desktopCookie);
    await connected(desk);

    // ② 桌面解绑 → 平板同一令牌新握手被拒（Phase 1 connect 期校验；存量 socket 主动断连属 Phase 2）
    await request(app.getHttpServer())
      .delete(`/api/expert/projects/${p1}/pairing`)
      .set('Cookie', desktopCookie).set(expertHeaders)
      .expect(200);
    const tabAfterRevoke = openSocket(tabletCookie);
    await serverKilled(tabAfterRevoke);
    expect(tabAfterRevoke.connected).toBe(false);

    // ③ 桌面登出 → 旧桌面 token（sid 已失配）新握手被拒——WS 面存量缺口修复回归
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', desktopCookie).set(expertHeaders)
      .expect(200);
    const deskAfterLogout = openSocket(desktopCookie);
    await serverKilled(deskAfterLogout);
    expect(deskAfterLogout.connected).toBe(false);
    // 注：解绑/登出前已建立的 desk 存量 socket Phase 1 不主动断连（spec §10/裁量 6）——不在断言面
  });
});
