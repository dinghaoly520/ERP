import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * 移动驾驶舱水叮当（:3011）安全 e2e（2026-10-22 P1 链路收口：ctx 穿参 + toolCompanyWhere + cockpit 工具）。
 *
 * 三断言语义：
 * 1. leader 直调 cockpit：卡片数字 === 同口径（本公司 + 本月）dashboard API 数字——
 *    cockpit.tool 与 dashboard.service 共用 getDashboard(monthStart, where)，等值即口径未漂移；
 * 2. 非 admin 伪造 ChatDto.context.companyIds 被服务端忽略（pickAdminCompanyIds 仅 admin 采纳），
 *    与 dashboard 非 admin 忽略 ?companyId= 同语义——两口径仍等值；
 * 3. 匿名访客（X-Assistant-Guest）直调 cockpit 被公开域门禁拒绝——
 *    PUBLIC_TOOLS={announcement}，cockpit 不在其中，拒答且不产卡片。
 *
 * 直调消息格式须与 assistant.service.ts directToolMatch 正则一致：
 *   /请调用\s+(\w+)\s+工具[，,]\s*参数\s+(\{[\s\S]*?\})/
 *
 * 非空泛化（防 0===0 空转）：beforeAll 种入本月口径测试数据——leader 本公司 1 轮 + 其他公司 2 轮
 * （id 前缀 e2e-cockpit-*，afterAll 清理）。两侧计数刻意不对称：若工具漏穿 ctx（全公司口径=3）或
 * 任一侧误采伪造 companyIds（=2），等值断言即红；leader 本公司 1 轮保证断言值 > 0 非空。
 */

/** 与 cockpit.tool.ts 同式计算本月 1 号（本地时区 YYYY-MM-01）——口径必须逐字节一致 */
function monthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

/** 本月 15 日 12:00（+08:00，与 dashboard startOfDay 同基准）——月中正午，时区边界安全 */
function midMonth(): Date {
  return new Date(`${monthStart().slice(0, 8)}15T12:00:00+08:00`);
}

const DIRECT_COCKPIT_MSG = '请调用 cockpit 工具，参数 {"action":"summary"}';

/** 取 cockpit 概览卡片（type=metric + 固定标题），避免依赖卡片下标 */
function cockpitMetrics(body: { cards?: Array<Record<string, unknown>> }): Array<{ label: string; value: string }> {
  const card = (body.cards ?? []).find(
    (c) => c.type === 'metric' && c.title === '本月驾驶舱概览',
  ) as { metrics?: Array<{ label: string; value: string }> } | undefined;
  return card?.metrics ?? [];
}

describe('移动驾驶舱水叮当（:3011）e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let leaderToken: string;
  let leaderCompanyId: string;
  let otherCompanyId: string;

  const SEED_IDS = [
    'e2e-cockpit-rd-leader',
    'e2e-cockpit-rd-other-1',
    'e2e-cockpit-rd-other-2',
  ];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);

    // leader 登录（e2e 允许轮换 web 会话）；login 端点 @HttpCode(200)，body 携带 access_token
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Portal', 'web')
      .send({ username: 'Swhi-CGZX-01', password: 'Swhi-CGZX-01@2026' })
      .expect(200);
    expect(res.body.role).toBe('leader');
    leaderToken = res.body.access_token as string;

    // 公司口径：leader 本公司 vs 任一他司（等值断言的两侧不对称来源）
    const leader = await prisma.user.findFirst({
      where: { username: 'Swhi-CGZX-01', role: 'leader' },
      select: { companyId: true },
    });
    expect(leader?.companyId).toBeTruthy();
    leaderCompanyId = leader!.companyId!;
    const other = await prisma.company.findFirst({
      where: { id: { not: leaderCompanyId } },
      select: { id: true },
    });
    expect(other?.id).toBeTruthy();
    otherCompanyId = other!.id;

    // 本月口径种子：leader 本公司 1 轮 + 他司 2 轮（幂等 upsert，固定 id 便于清理）
    await prisma.project.upsert({
      where: { id: 'e2e-cockpit-proj' },
      update: {},
      create: { id: 'e2e-cockpit-proj', name: 'e2e-cockpit 口径等值测试项目' },
    });
    const roundSeeds: Array<{ id: string; companyId: string; roundNo: number }> = [
      { id: SEED_IDS[0], companyId: leaderCompanyId, roundNo: 1 },
      { id: SEED_IDS[1], companyId: otherCompanyId, roundNo: 2 },
      { id: SEED_IDS[2], companyId: otherCompanyId, roundNo: 3 },
    ];
    for (const seed of roundSeeds) {
      await prisma.procurementRound.upsert({
        where: { id: seed.id },
        update: { procurementDate: midMonth(), companyId: seed.companyId, isRecycled: false },
        create: {
          id: seed.id,
          projectId: 'e2e-cockpit-proj',
          roundNo: seed.roundNo,
          procurementDate: midMonth(),
          procurementMethod: '公开招标',
          companyId: seed.companyId,
        },
      });
    }
  });

  it('leader 直调 cockpit：卡片数字 === 同口径 dashboard API 数字（不越公司）', async () => {
    const chat = await request(app.getHttpServer())
      .post('/api/assistant/chat')
      .set('X-Portal', 'web')
      .set('X-Web-Token', leaderToken)
      .send({ message: DIRECT_COCKPIT_MSG })
      .expect(201);

    // dashboard 同口径 = 本公司（leader scope）+ 本月（startDate=本月1号，与 cockpit monthStart 一致）
    const dash = await request(app.getHttpServer())
      .get('/api/dashboard')
      .query({ startDate: monthStart() })
      .set('X-Portal', 'web')
      .set('X-Web-Token', leaderToken)
      .expect(200);

    const metrics = cockpitMetrics(chat.body);
    expect(metrics.length).toBeGreaterThan(0);
    const roundMetric = metrics.find((m) => m.label === '采购轮次')?.value;
    // 非空泛化：种子保证 leader 本公司本月 ≥1——若工具漏穿 ctx 成全公司口径，值为 1+2=3 ≠ dashboard
    expect(Number(roundMetric)).toBeGreaterThan(0);
    expect(roundMetric).toBe(String(dash.body.summary.totalCount));
  });

  it('非 admin 伪造 context.companyIds 被忽略', async () => {
    const chat = await request(app.getHttpServer())
      .post('/api/assistant/chat')
      .set('X-Portal', 'web')
      .set('X-Web-Token', leaderToken)
      // 伪造他司真实 id——若误采，dashboard 会切到他司口径（2 轮）≠ cockpit 本公司口径
      .send({ message: DIRECT_COCKPIT_MSG, context: { companyIds: [otherCompanyId] } })
      .expect(201);

    // 非 admin 的 dashboard ?companyId= 被忽略 → 两口径都是 leader 本公司 → 数字仍一致
    const dash = await request(app.getHttpServer())
      .get('/api/dashboard')
      .query({ startDate: monthStart(), companyId: otherCompanyId })
      .set('X-Portal', 'web')
      .set('X-Web-Token', leaderToken)
      .expect(200);

    const metrics = cockpitMetrics(chat.body);
    expect(metrics.length).toBeGreaterThan(0);
    const roundMetric = metrics.find((m) => m.label === '采购轮次')?.value;
    expect(Number(roundMetric)).toBeGreaterThan(0);
    expect(roundMetric).toBe(String(dash.body.summary.totalCount));
  });

  it('匿名访客调用 cockpit 被拒（公开域门禁）', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/assistant/chat')
      .set('X-Assistant-Guest', 'guestkey12345') // 命中 /^[A-Za-z0-9_-]{8,64}$/ 即为合法访客键
      .send({ message: DIRECT_COCKPIT_MSG })
      .expect(201);

    // PUBLIC_TOOLS 门禁拒答话术（handleDirectToolCall）含「登录」指引
    expect(r.body.answer).toContain('登录');
    // 拒答即拒数据：不得产出任何卡片（防内部口径经卡片旁路泄漏）
    expect(r.body.cards).toEqual([]);
  });

  afterAll(async () => {
    // 清理种子（先轮次后项目；project 级联删轮次，双保险）
    await prisma.procurementRound.deleteMany({ where: { id: { in: SEED_IDS } } });
    await prisma.project.deleteMany({ where: { id: 'e2e-cockpit-proj' } });
    await app.close();
  });
});
