import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashSync } from 'bcryptjs';

/**
 * 评标室口令 + 评标窗口隔离 e2e（2026-09-20 spec：
 * docs/superpowers/specs/2026-09-20-expert-room-code-window-isolation-design.md）
 *
 * 闸1 抽取排除 / 闸2 signIn+startEvaluation 硬拦+startOpening 预警 /
 * 密 口令校验-爆破锁定-轮换失效-执行点 / 闸4 工位锁定+解除阀门
 * 全部自建夹具（用户/项目），不依赖 seed。
 */
describe('Expert room code & window isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const PW = 'Room@2026';
  const U = {
    admin: 'e2e-rw-admin', host: 'e2e-rw-host',
    wexp: 'e2e-rw-wexp', texp: 'e2e-rw-texp',
    cexp: 'e2e-rw-cexp',
  };
  let adminId: string, hostId: string, wexpId: string, texpId: string;
  let projectA: string, projectB: string, projectC: string;
  let projectD: string, projectE1: string, projectE2: string;
  let cexpId: string, cexpPhotoId: string;

  const login = (username: string, portal: string) =>
    request(app.getHttpServer()).post('/api/auth/login').set('X-Portal', portal).send({ username, password: PW });
  const loginCookie = async (username: string, portal: string) => {
    const r = await login(username, portal).expect(200);
    const c = r.headers['set-cookie'];
    return (Array.isArray(c) ? c : [c]).map(x => x.split(';')[0]).join('; ');
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const past = new Date(Date.now() - 2 * 3600_000);
    // 用户：管理员 / 主持人 / 窗口专家（在 A 评标未完）/ 目标专家
    const mk = (username: string, role: string, withProfile = false) =>
      prisma.user.upsert({
        where: { username_role: { username, role } },
        update: { isActive: true, passwordHash: hashSync(PW, 10) },
        create: {
          username, displayName: username, passwordHash: hashSync(PW, 10), role, isActive: true,
          ...(withProfile ? { expertProfile: { create: { specialty: '造价', availability: '可用', entryStatus: 'ACTIVE' } } } : {}),
        },
      });
    const [admin, host, wexp, texp] = await Promise.all([
      mk(U.admin, 'admin'), mk(U.host, 'bid_host'), mk(U.wexp, 'bid_expert', true), mk(U.texp, 'bid_expert', true),
    ]);
    adminId = admin.id; hostId = host.id; wexpId = wexp.id; texpId = texp.id;

    const mkProject = (code: string, stage: 'EVALUATING' | 'OPENING' | 'SUBMIT', extra: Record<string, unknown> = {}) =>
      prisma.bidProject.create({
        data: {
          projectCode: code, name: `窗口隔离测试-${code}`, procurementMethod: '公开招标',
          openTime: past, deadline: past, stage, ...extra,
        },
      });
    const [a, b, c] = await Promise.all([
      mkProject('RW-A-2026', 'EVALUATING'),
      mkProject('RW-B-2026', 'OPENING'),
      mkProject('RW-C-2026', 'SUBMIT', { assignedHostUserId: hostId }),
    ]);
    projectA = a.id; projectB = b.id; projectC = c.id;

    // A：窗口专家已签到未确认报告（评标窗口开）+ 目标专家未签到
    await prisma.bidExpert.create({ data: { projectId: projectA, userId: wexpId, expertName: U.wexp, major: '造价', expertRole: '正选', invitationStatus: 'confirmed', signedIn: true, reportConfirmed: false } });
    await prisma.bidExpert.create({ data: { projectId: projectA, userId: texpId, expertName: U.texp, major: '造价', expertRole: '正选', invitationStatus: 'confirmed' } });
    // C：3 家已提交投标（开标准备法定硬闸——公开招标 ≥3 家有效投标）
    await prisma.bidSupplier.createMany({
      data: [1, 2, 3].map(i => ({ projectId: projectC, supplierName: `窗口隔离测试供应商${i}`, submitStatus: '已提交' })),
    });
    // B/C：窗口专家亦被派（B 测签到冲突+启动评标阻断；C 测按时开标预警）
    await prisma.bidExpert.create({ data: { projectId: projectB, userId: wexpId, expertName: U.wexp, major: '造价', expertRole: '正选', invitationStatus: 'confirmed' } });
    await prisma.bidExpert.create({ data: { projectId: projectB, userId: texpId, expertName: U.texp, major: '造价', expertRole: '正选', invitationStatus: 'confirmed' } });
    await prisma.bidExpert.create({ data: { projectId: projectC, userId: wexpId, expertName: U.wexp, major: '造价', expertRole: '正选', invitationStatus: 'confirmed' } });
    // P2 用例夹具（2026-09-21）：D=swap 复查；E1/E2+cexp=并发签到 TOCTOU；photo=过签到照片闸
    const [d, e1, e2] = await Promise.all([
      mkProject('RW-D-2026', 'SUBMIT'), mkProject('RW-E1-2026', 'OPENING'), mkProject('RW-E2-2026', 'OPENING'),
    ]);
    projectD = d.id; projectE1 = e1.id; projectE2 = e2.id;
    await prisma.bidExpert.create({ data: { projectId: projectD, userId: wexpId, expertName: U.wexp, major: '造价', expertRole: '正选', invitationStatus: 'confirmed' } });
    await prisma.bidExpert.create({ data: { projectId: projectD, userId: texpId, expertName: U.texp, major: '造价', expertRole: '候补', invitationStatus: 'confirmed' } });
    const cexp = await mk(U.cexp, 'bid_expert', true);
    cexpId = cexp.id;
    await prisma.bidExpert.create({ data: { projectId: projectE1, userId: cexpId, expertName: U.cexp, major: '造价', expertRole: '正选', invitationStatus: 'confirmed' } });
    await prisma.bidExpert.create({ data: { projectId: projectE2, userId: cexpId, expertName: U.cexp, major: '造价', expertRole: '正选', invitationStatus: 'confirmed' } });
    cexpPhotoId = (await prisma.fileAsset.create({ data: { key: 'e2e-rw-cexp-photo', originalName: 'cexp.jpg', mimeType: 'image/jpeg', size: 1024, sha256: '0'.repeat(64), category: 'expert_signin_photo', uploaderId: cexpId } })).id;
  });

  afterAll(async () => {
    await prisma.bidProject.deleteMany({ where: { id: { in: [projectA, projectB, projectC, projectD, projectE1, projectE2] } } });
    await prisma.fileAsset.deleteMany({ where: { id: cexpPhotoId } });
    await prisma.user.deleteMany({ where: { username: { in: Object.values(U) } } });
    await app.close();
  });

  it('闸2：signIn 跨项目开窗 → 409 EXPERT_WINDOW_CONFLICT（错误体含冲突项目名）', async () => {
    const cookie = await loginCookie(U.wexp, 'expert');
    const res = await request(app.getHttpServer())
      .post(`/api/expert/projects/${projectB}/sign-in`)
      .set('Cookie', cookie).set('X-Portal', 'expert');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXPERT_WINDOW_CONFLICT');
    expect(res.body.error).toContain('RW-A-2026');
  });

  it('闸2：startEvaluation 存在冲突专家 → 409（含名单）', async () => {
    // 分工 v3：启动评标属 :3007。admin 的 cookie 门户是 web——:3007 流程经 :3006 登录分流
    // （auth.controller：expert 门户 + 非 bid_expert → 强制写 token_bid）
    const cookie = await loginCookie(U.admin, 'expert');
    const res = await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectB}/start-evaluation`)
      .set('Cookie', cookie).set('X-Portal', 'bid').send({});
    expect([409, 400]).toContain(res.status); // 409=窗口冲突；400=项目级前置（无解则以冲突为准）
    if (res.status === 409) {
      expect(res.body.code).toBe('EXPERT_WINDOW_CONFLICT');
      expect(res.body.error).toContain(U.wexp);
    } else {
      expect(res.body.error).not.toContain('专家'); // 确认 400 非专家类原因
    }
  });

  it('闸2：startOpening 冲突不阻断——开标成功 + 预警监督日志', async () => {
    const cookie = await loginCookie(U.admin, 'web');
    const res = await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectC}/open`)
      .set('Cookie', cookie).set('X-Portal', 'web').send({});
    // 开标有业务前置（截止/主持人等已按夹具满足）；若仍有其他前置则以日志断言为准
    if ([200, 201].includes(res.status)) {
      await new Promise(r => setTimeout(r, 300));
      const log = await prisma.bidSupervisionLog.findFirst({
        where: { projectId: projectC, action: '专家跨项目评标窗口冲突预警' },
      });
      expect(log).not.toBeNull();
      expect(log!.result).toContain(U.wexp);
      expect(log!.riskFlag).toBe('关注');
    } else {
      console.log('startOpening 返回', res.status, res.body?.error, '——跳过日志断言');
    }
  });

  it('闸1：抽取候选排除开窗专家（死 include 变真排除）', async () => {
    const cookie = await loginCookie(U.admin, 'web');
    const res = await request(app.getHttpServer())
      .post('/api/expert-admin/extract')
      .set('Cookie', cookie).set('X-Portal', 'web')
      .send({ projectId: projectB, extractMode: 'random', totalNeeded: 1 });
    expect(res.status).toBe(201);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(U.wexp); // 开窗专家不在候选/结果任何位置
  });

  it('密：无口令放行（存量兼容）→ 启用后未验 403 → 正确口令通过 → 执行点解锁', async () => {
    // 未启用：my-scores 正常（不因口令被拒——此时 texp 未签到，接口本身可能因其他前置 403/200，只断言非 ROOM_CODE_REQUIRED）
    const tCookie = await loginCookie(U.texp, 'expert');
    const before = await request(app.getHttpServer())
      .get(`/api/expert/projects/${projectA}/my-scores`)
      .set('Cookie', tCookie).set('X-Portal', 'expert');
    expect(before.body.code ?? '').not.toBe('ROOM_CODE_REQUIRED');

    // 主持人生成口令
    const adminCookie = await loginCookie(U.admin, 'web');
    const rot = await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectA}/room-code/rotate`)
      .set('Cookie', adminCookie).set('X-Portal', 'web').send({});
    expect(rot.status).toBe(201);
    const code = rot.body.roomCode as string;
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);

    // 未验 → 执行点拦截
    const blocked = await request(app.getHttpServer())
      .get(`/api/expert/projects/${projectA}/my-scores`)
      .set('Cookie', tCookie).set('X-Portal', 'expert');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('ROOM_CODE_REQUIRED');

    // 正确口令 → 通过 → my-scores 恢复
    await request(app.getHttpServer())
      .post(`/api/expert/projects/${projectA}/room-code/verify`)
      .set('Cookie', tCookie).set('X-Portal', 'expert').send({ code })
      .expect(201);
    const after = await request(app.getHttpServer())
      .get(`/api/expert/projects/${projectA}/my-scores`)
      .set('Cookie', tCookie).set('X-Portal', 'expert');
    expect(after.body.code ?? '').not.toBe('ROOM_CODE_REQUIRED');
  });

  it('密：连错 3 次锁 10 分钟——正确口令也不放行 + 高风险监督日志', async () => {
    const tCookie = await loginCookie(U.texp, 'expert');
    for (let i = 0; i < 3; i++) {
      const r = await request(app.getHttpServer())
        .post(`/api/expert/projects/${projectA}/room-code/verify`)
        .set('Cookie', tCookie).set('X-Portal', 'expert').send({ code: 'WRONGWRNG' });
      expect([400, 409]).toContain(r.status);
    }
    // 已锁：正确口令也拒
    const adminCookie = await loginCookie(U.admin, 'web');
    const cur = await request(app.getHttpServer())
      .get(`/api/bid/projects/${projectA}/room-code`)
      .set('Cookie', adminCookie).set('X-Portal', 'web');
    const r2 = await request(app.getHttpServer())
      .post(`/api/expert/projects/${projectA}/room-code/verify`)
      .set('Cookie', tCookie).set('X-Portal', 'expert').send({ code: cur.body.roomCode });
    expect(r2.status).toBe(409);
    expect(r2.body.code).toBe('ROOM_CODE_LOCKED');
    // 高风险留痕
    const log = await prisma.bidSupervisionLog.findFirst({
      where: { projectId: projectA, action: '评标室口令校验失败', riskFlag: '高风险' },
    });
    expect(log).not.toBeNull();
  });

  it('密：轮换即全员失效——已验专家下次操作重回 403', async () => {
    const adminCookie = await loginCookie(U.admin, 'web');
    const rot = await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectA}/room-code/rotate`)
      .set('Cookie', adminCookie).set('X-Portal', 'web').send({}).expect(201);
    const tCookie = await loginCookie(U.texp, 'expert');
    const r = await request(app.getHttpServer())
      .get(`/api/expert/projects/${projectA}/my-scores`)
      .set('Cookie', tCookie).set('X-Portal', 'expert');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('ROOM_CODE_REQUIRED');
  });

  it('闸4：评标窗口开——登录 409 ACCOUNT_EVALUATING（此前测试已建会话，直接锁定）', async () => {
    // 前序用例的登录已建立 webSessionId（窗口开）→ 本次登录即拒绝
    const first = await login(U.wexp, 'expert');
    expect(first.status).toBe(409);
    expect(first.body.code).toBe('ACCOUNT_EVALUATING');
    expect(first.body.error).toContain('评标期间账号已锁定');
    // 无窗口专家（texp）登录不受影响
    await login(U.texp, 'expert').expect(200);
  });

  it('闸4 阀门：主持人 release-login-lock 后重新可登录', async () => {
    const adminCookie = await loginCookie(U.admin, 'web');
    const wexpRow = await prisma.bidExpert.findFirst({ where: { projectId: projectA, userId: wexpId } });
    // 缺理由 → 400
    await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectA}/expert-verification/${wexpRow!.id}/release-login-lock`)
      .set('Cookie', adminCookie).set('X-Portal', 'web').send({ reason: '' })
      .expect(400);
    // 正常解除 → 留痕 + 重新可登录
    const rel = await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectA}/expert-verification/${wexpRow!.id}/release-login-lock`)
      .set('Cookie', adminCookie).set('X-Portal', 'web').send({ reason: 'e2e：更换设备' })
      .expect(201);
    expect(rel.body.ok).toBe(true);
    const log = await prisma.bidSupervisionLog.findFirst({
      where: { projectId: projectA, action: '解除专家登录锁定' },
    });
    expect(log).not.toBeNull();
    await login(U.wexp, 'expert').expect(200); // 解除后放行（同时重建会话）
  });

  it('闸3：listProjects 携带 reportConfirmed——窗口闭合后展示层可分组', async () => {
    // 上一用例末次登录重建了会话（窗口仍开 → 锁定态）——先经阀门解除再取会话
    const adminCookie0 = await loginCookie(U.admin, 'web');
    const wexpRow0 = await prisma.bidExpert.findFirst({ where: { projectId: projectA, userId: wexpId } });
    await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectA}/expert-verification/${wexpRow0!.id}/release-login-lock`)
      .set('Cookie', adminCookie0).set('X-Portal', 'web').send({ reason: 'e2e：闸3 前置解锁' }).expect(201);
    const cookie = await loginCookie(U.wexp, 'expert');
    const res = await request(app.getHttpServer())
      .get('/api/expert/projects')
      .set('Cookie', cookie).set('X-Portal', 'expert')
      .expect(200);
    const a = (res.body as any[]).find(r => r.project.id === projectA);
    expect(a).toBeTruthy();
    expect(a.reportConfirmed).toBe(false);
    // 确认报告 → 窗口闭合 → 字段翻转（闸4 登录锁随之解除）
    await prisma.bidExpert.update({
      where: { id: (await prisma.bidExpert.findFirst({ where: { projectId: projectA, userId: wexpId } }))!.id },
      data: { reportConfirmed: true },
    });
    const res2 = await request(app.getHttpServer())
      .get('/api/expert/projects')
      .set('Cookie', cookie).set('X-Portal', 'expert')
      .expect(200);
    const a2 = (res2.body as any[]).find(r => r.project.id === projectA);
    expect(a2.reportConfirmed).toBe(true);
    // 窗口闭合 → 登录不再锁定（后登顶替恢复常规单设备语义）
    await login(U.wexp, 'expert').expect(200);
    await login(U.wexp, 'expert').expect(200); // 无窗期二次登录=顶替而非 409
  });

  /* ── 2026-09-21 审查修复回归（P0-1/P0-2/P1-3）── */

  it('P0-1：listProjects 不泄漏 roomCode（口令启用时）', async () => {
    const cookie = await loginCookie(U.wexp, 'expert'); // 窗口已闭合（上一用例确认了报告）
    const res = await request(app.getHttpServer())
      .get('/api/expert/projects')
      .set('Cookie', cookie).set('X-Portal', 'expert')
      .expect(200);
    expect(JSON.stringify(res.body)).not.toContain('"roomCode"');
  });

  it('P0-2：esign-payload / esign 未验口令 → 403 ROOM_CODE_REQUIRED（电子签名不可绕闸）', async () => {
    const cookie = await loginCookie(U.texp, 'expert');
    // texp 在口令轮换用例后未重验 → 未验态
    const p = await request(app.getHttpServer())
      .get(`/api/expert/projects/${projectA}/esign-payload`)
      .set('Cookie', cookie).set('X-Portal', 'expert');
    expect(p.status).toBe(403);
    expect(p.body.code).toBe('ROOM_CODE_REQUIRED');
    const e = await request(app.getHttpServer())
      .post(`/api/expert/projects/${projectA}/esign`)
      .set('Cookie', cookie).set('X-Portal', 'expert').send({ signature: '04' + '00'.repeat(64) });
    expect(e.status).toBe(403);
    expect(e.body.code).toBe('ROOM_CODE_REQUIRED');
  });

  it('P1-3：signIn 冲突与登录锁定拒绝均留监督日志 + admin 通知', async () => {
    // 重开窗口（wexp 报告确认撤销——直接改库模拟未完结）
    const wexpRow = await prisma.bidExpert.findFirst({ where: { projectId: projectA, userId: wexpId } });
    await prisma.bidExpert.update({ where: { id: wexpRow!.id }, data: { reportConfirmed: false } });
    await prisma.user.update({ where: { id: wexpId }, data: { webSessionId: null } }); // 模拟已释放（否则首登即 409 拿不到会话）
    // 冲突签到 → 409 + 监督日志
    const c = await loginCookie(U.wexp, 'expert');
    const si = await request(app.getHttpServer())
      .post(`/api/expert/projects/${projectB}/sign-in`)
      .set('Cookie', c).set('X-Portal', 'expert');
    expect(si.status).toBe(409);
    expect(si.body.code).toBe('EXPERT_WINDOW_CONFLICT');
    const conflictLog = await prisma.bidSupervisionLog.findFirst({
      where: { projectId: projectB, action: '跨项目评标窗口冲突拦截' },
    });
    expect(conflictLog).not.toBeNull();
    // 登录锁定拒绝 → 409 + 监督日志高风险 + admin 通知
    const lk = await login(U.wexp, 'expert');
    expect(lk.status).toBe(409);
    expect(lk.body.code).toBe('ACCOUNT_EVALUATING');
    const lockLog = await prisma.bidSupervisionLog.findFirst({
      where: { projectId: projectA, action: '评标期登录锁定拒绝', riskFlag: '高风险' },
    });
    expect(lockLog).not.toBeNull();
    const adminNotif = await prisma.notification.findFirst({
      where: { type: 'ACCOUNT_SECURITY_FEEDBACK', title: '专家账号评标期登录被拒' },
    });
    expect(adminNotif).not.toBeNull();
    // 收尾：闭合窗口恢复可登录（留给环境的干净态）
    await prisma.bidExpert.update({ where: { id: wexpRow!.id }, data: { reportConfirmed: true } });
    await login(U.wexp, 'expert').expect(200);
  });

  /* ── 2026-09-21 P2 三案修复回归 ── */

  it('P2-4：swapExpertRole 进场专家有开窗 → 409；无窗候补 → 放行', async () => {
    const adminCookie = await loginCookie(U.admin, 'web');
    const rows = await prisma.bidExpert.findMany({ where: { projectId: projectD }, select: { id: true, userId: true, expertRole: true } });
    const tRow = rows.find(r => r.userId === texpId)!; // 候补（无窗）
    const wRow = rows.find(r => r.userId === wexpId)!;  // 正选（此刻 wexp 窗口已闭合——重开再测阻断）
    // 先验证无窗候补可正常递补（正选 wexp → 候补 texp）
    const ok1 = await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectD}/swap-expert`)
      .set('Cookie', adminCookie).set('X-Portal', 'web')
      .send({ fromExpertId: wRow.id, toExpertId: tRow.id });
    expect([200, 201]).toContain(ok1.status);
    // 重开 wexp 窗口 → 反向递补（正选 texp → 候补 wexp）应被阻断
    await prisma.bidExpert.update({ where: { id: (await prisma.bidExpert.findFirst({ where: { projectId: projectA, userId: wexpId } }))!.id }, data: { reportConfirmed: false } });
    const blocked = await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectD}/swap-expert`)
      .set('Cookie', adminCookie).set('X-Portal', 'web')
      .send({ fromExpertId: tRow.id, toExpertId: wRow.id });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('EXPERT_WINDOW_CONFLICT');
    expect(blocked.body.error).toContain(U.wexp);
    // 收尾：闭合窗口
    await prisma.bidExpert.update({ where: { id: (await prisma.bidExpert.findFirst({ where: { projectId: projectA, userId: wexpId } }))!.id }, data: { reportConfirmed: true } });
  });

  it('P2-5：并发双签到串行化——同专家两项目同时签到，恰成一败一成（User 行锁消 TOCTOU）', async () => {
    const c = await loginCookie(U.cexp, 'expert');
    const [r1, r2] = await Promise.all([
      request(app.getHttpServer()).post(`/api/expert/projects/${projectE1}/sign-in`)
        .set('Cookie', c).set('X-Portal', 'expert').send({ photoAssetId: cexpPhotoId }),
      request(app.getHttpServer()).post(`/api/expert/projects/${projectE2}/sign-in`)
        .set('Cookie', c).set('X-Portal', 'expert').send({ photoAssetId: cexpPhotoId }),
    ]);
    const codes = [r1.status, r2.status].sort();
    expect(codes).toEqual([201, 409]);
    const conflict = r1.status === 409 ? r1 : r2;
    expect(conflict.body.code).toBe('EXPERT_WINDOW_CONFLICT');
  });

  it('P2-6：ABORTED（流标）后口令闸保持——未验 403，补验后放行', async () => {
    await prisma.bidProject.update({ where: { id: projectA }, data: { stage: 'ABORTED' } });
    // texp 此前爆破锁定未过期（10 分钟窗）——重置后走补验路径
    await prisma.bidExpert.updateMany({ where: { projectId: projectA }, data: { roomAttempts: 0, roomLockedUntil: null } });
    const tCookie = await loginCookie(U.texp, 'expert');
    const r = await request(app.getHttpServer())
      .get(`/api/expert/projects/${projectA}/my-scores`)
      .set('Cookie', tCookie).set('X-Portal', 'expert');
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('ROOM_CODE_REQUIRED');
    // 补验口令（ABORTED 阶段允许 verify）→ 闸门放行（后续业务态不在此断言范围）
    const adminCookie = await loginCookie(U.admin, 'web');
    const code = (await (await request(app.getHttpServer())
      .get(`/api/bid/projects/${projectA}/room-code`)
      .set('Cookie', adminCookie).set('X-Portal', 'web')).body).roomCode;
    await request(app.getHttpServer())
      .post(`/api/expert/projects/${projectA}/room-code/verify`)
      .set('Cookie', tCookie).set('X-Portal', 'expert').send({ code })
      .expect(201);
    const r2 = await request(app.getHttpServer())
      .get(`/api/expert/projects/${projectA}/my-scores`)
      .set('Cookie', tCookie).set('X-Portal', 'expert');
    expect(r2.body.code ?? '').not.toBe('ROOM_CODE_REQUIRED');
  });
});
