// 对接专项 Phase 1 platform-push e2e（T6，2026-09-09）
// 流程：pending（ready 行 + not-ready 行双验）→ preview（中间信封+指纹）→ mock dispatch 全链
//       （SUCCESS+三重留痕）→ 幂等 409 → 指纹篡改 400 PAYLOAD_DRIFT → stub 通道 501+STUB_REFUSED
//       → offline 导出三件套（EXPORTED+FileAsset+下载+台账聚合）→ not-ready 双闸 400
//       → 公告发布赋码闸（无码项目 400 GB_CODE_REQUIRED / 有码放行 201）。
// fixture 全自建自清（不碰引大济岷/hero 演示数据——dispatch 只对自建项目+公告留痕）；
// 惯例（app 启动/loginAs）与 supervision-push.e2e-spec.ts 同源。
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';

/** 登录并返回 cookie；需带 X-Portal 以匹配按门户命名的 cookie */
async function loginAs(
  app: INestApplication,
  username: string,
  password: string,
  portal: string,
): Promise<string[]> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .set('X-Portal', portal)
    .send({ username, password });
  const cookie = res.headers['set-cookie'];
  return Array.isArray(cookie) ? cookie : cookie ? [cookie] : [];
}

const PREFIX = 'E2E-PP-'; // fixture 唯一前缀：beforeAll 预清扫崩溃残留 + afterAll 定向清理都锚它

describe('对接专项 platform-push 人工确认制 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let staffCookie: string[];

  // fixture：有码项目 A（公告×2：招标+补遗；合同 amount/signedAt 空=not-ready）+ 无码项目 B（公告 1）
  const ts = Date.now();
  const codeA = `${PREFIX}A-${ts}`;
  const codeB = `${PREFIX}B-${ts}`;
  /** 21 位国标采购编码形态（511/0000/2026/流水/001）——pending/信封只校验存在性与透传，值仅需形态合法 */
  const gb21 = `511000002026${String(ts % 1_000_000).padStart(6, '0')}001`;

  let projAId = '';
  let projBId = '';
  let annA1Id = ''; // BID_NOTICE（mock 全链用）
  let annA2Id = ''; // ADDENDUM→clarify（drift/stub/offline 用）
  let annB1Id = ''; // 无码项目公告（pending not-ready 行）
  let annA3Id = ''; // PERFORMANCE_NOTICE→fulfillment（Phase 2 K2 e2e 用）
  let contractId = ''; // not-ready 合同（amount/signedAt 空）
  const itemAnnA1 = () => `announcement:${annA1Id}`;
  const itemAnnA2 = () => `announcement:${annA2Id}`;
  const itemContract = () => `contract:${contractId}`;
  // 赋码闸放行路径经 API 创建的公告（afterAll 清理账本）
  const createdAnnouncementIds: string[] = [];

  /** 离线导出包善后：删 MinIO 对象（best-effort）+ FileAsset 行（锚 fixture 前缀，不碰演示包） */
  const purgeExportPackages = async (match: { keyPrefix?: string; nameContains?: string }) => {
    const rows = await prisma.fileAsset.findMany({
      where: {
        category: 'platform_push_package',
        ...(match.keyPrefix ? { key: { startsWith: match.keyPrefix } } : {}),
        ...(match.nameContains ? { originalName: { contains: match.nameContains } } : {}),
      },
      select: { id: true, key: true },
    });
    for (const r of rows) await storage.delete(r.key).catch(() => {});
    if (rows.length) await prisma.fileAsset.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  };

  /** fixture 五表定向清扫（崩溃残留/本轮产物共用；projectId 走等值集合，projectCode 走前缀兜底） */
  const purgeFixture = async () => {
    await prisma.announcement.deleteMany({
      where: { OR: [{ relatedProjectCode: { startsWith: `${PREFIX}` } }, { id: { in: createdAnnouncementIds } }] },
    }).catch(() => {});
    await prisma.platformPushLog.deleteMany({
      where: { projectCode: { startsWith: PREFIX } },
    }).catch(() => {});
    await prisma.contract.deleteMany({ where: { projectCode: { startsWith: PREFIX } } }).catch(() => {});
    const stale = await prisma.bidProject.findMany({
      where: { projectCode: { startsWith: PREFIX } }, select: { id: true },
    });
    await prisma.auditLog.deleteMany({
      where: { action: 'PLATFORM_PUSH', resourceId: { in: stale.map((p) => p.id) } },
    }).catch(() => {});
    // PlatformPushLog.penalty 行无项目锚——本套件不造 penalty，只按 projectCode 已扫；BidProject 级联监督日志
    await prisma.bidProject.deleteMany({ where: { projectCode: { startsWith: PREFIX } } }).catch(() => {});
    await purgeExportPackages({ nameContains: PREFIX });
  };

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
    storage = app.get(StorageService);
    staffCookie = await loginAs(app, 'Swhi-CGZX-05', 'Swhi-CGZX-05@2026', 'web');

    // 预清扫上一轮崩溃残留（幂等），再铺本轮 fixture
    await purgeFixture();

    const projA = await prisma.bidProject.create({
      data: {
        projectCode: codeA, name: `${PREFIX}有码推送项目`, procurementMethod: '公开招标',
        deadline: new Date(ts + 48 * 3600_000), openTime: new Date(ts + 72 * 3600_000),
        gbProcureCode: gb21, budget: 1200000, ceilingPrice: 1100000,
      },
    });
    const projB = await prisma.bidProject.create({
      data: {
        projectCode: codeB, name: `${PREFIX}无码闸项目`, procurementMethod: '询比',
        deadline: new Date(ts + 48 * 3600_000), openTime: new Date(ts + 72 * 3600_000),
      },
    });
    projAId = projA.id;
    projBId = projB.id;

    const annA1 = await prisma.announcement.create({
      data: {
        title: `${PREFIX}招标公告A1`, content: '<p>e2e fixture 招标公告</p>',
        type: 'BID_NOTICE', status: 'PUBLISHED', publishDate: new Date(ts - 3600_000),
        relatedProjectCode: codeA, authorId: null,
      },
    });
    const annA2 = await prisma.announcement.create({
      data: {
        title: `${PREFIX}补遗公告A2`, content: '<p>e2e fixture 补遗</p>',
        type: 'ADDENDUM', status: 'PUBLISHED', publishDate: new Date(ts),
        relatedProjectCode: codeA, authorId: null,
      },
    });
    const annB1 = await prisma.announcement.create({
      data: {
        title: `${PREFIX}无码项目公告B1`, content: '<p>e2e fixture 无码</p>',
        type: 'BID_NOTICE', status: 'PUBLISHED', publishDate: new Date(ts),
        relatedProjectCode: codeB, authorId: null,
      },
    });
    annA1Id = annA1.id;
    annA2Id = annA2.id;
    annB1Id = annB1.id;

    const annA3 = await prisma.announcement.create({
      data: {
        title: `${PREFIX}履约公告A3`, content: '<p>e2e fixture 履约结果</p>',
        type: 'PERFORMANCE_NOTICE', status: 'PUBLISHED', publishDate: new Date(ts),
        relatedProjectCode: codeA, authorId: null,
      },
    });
    annA3Id = annA3.id;

    const contract = await prisma.contract.create({
      data: {
        contractCode: `${PREFIX}C-${ts}`, projectId: projA.id, projectCode: codeA,
        supplierId: 'e2e-pp-fixture-supplier', supplierName: 'E2E推送fixture供应商',
        amount: null, signedAt: null, // 完整度判定真源：amount/signedAt 空 → not-ready
      },
    });
    contractId = contract.id;
  });

  afterAll(async () => {
    // 兜底卫生（失败中途退出也复原）：本轮产物按前缀清 + MinIO 导出包对象随删
    await purgeFixture();
    await app.close();
  });

  it('pending：有码项目清单——公告行 ready、合同行 not-ready（missing 含 amount/signedAt）+ 五通道元数据', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/platform-push/pending?projectId=${projAId}`)
      .set('Cookie', staffCookie)
      .set('X-Portal', 'web')
      .expect(200);
    expect(res.body.project).toMatchObject({ id: projAId, projectCode: codeA, gbProcureCode: gb21 });
    expect(res.body.channels.map((c: { code: string }) => c.code).sort()).toEqual(
      ['ceb_national', 'mock', 'mwr_water', 'offline', 'sc_province'],
    );
    const items = res.body.items as { itemId: string; ready: boolean; missing: string[] }[];
    const a1 = items.find((i) => i.itemId === itemAnnA1());
    const a2 = items.find((i) => i.itemId === itemAnnA2());
    const c1 = items.find((i) => i.itemId === itemContract());
    expect(a1).toMatchObject({ itemType: 'bid_notice', ready: true, missing: [] });
    expect(a2).toMatchObject({ itemType: 'clarify', ready: true });
    expect(c1).toMatchObject({ itemType: 'contract', ready: false });
    expect(c1!.missing).toEqual(expect.arrayContaining(['amount', 'signedAt']));
  });

  it('pending：无码项目公告行 ready=false 且 missing 含 gbProcureCode', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/platform-push/pending?projectId=${projBId}`)
      .set('Cookie', staffCookie)
      .set('X-Portal', 'web')
      .expect(200);
    const b1 = (res.body.items as { itemId: string; ready: boolean; missing: string[] }[])
      .find((i) => i.itemId === `announcement:${annB1Id}`);
    expect(b1).toBeTruthy();
    expect(b1!.ready).toBe(false);
    expect(b1!.missing).toContain('gbProcureCode');
  });

  it('preview：中间信封（gbProcureCode/标题/字段映射）+ 64 位载荷指纹', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/platform-push/preview')
      .set('Cookie', staffCookie)
      .set('X-Portal', 'web')
      .send({ itemIds: [itemAnnA1()] })
      .expect(201);
    expect(res.body.schema).toBe('sc-v2-preview');
    const row = res.body.items[0];
    expect(row.itemId).toBe(itemAnnA1());
    expect(row.envelope).toMatchObject({
      itemType: 'bid_notice', schema: 'sc-v2-preview',
      projectCode: codeA, gbProcureCode: gb21, title: `${PREFIX}招标公告A1`, masked: [],
    });
    expect(row.envelope.fields).toMatchObject({ procurementMethod: '公开招标' });
    expect(row.envelope.publishedAt).toBeTruthy();
    expect(row.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('mock dispatch：201 SUCCESS（MOCK- 回执）+ PlatformPushLog/监督日志/审计三重留痕', async () => {
    const prev = await request(app.getHttpServer())
      .post('/api/platform-push/preview')
      .set('Cookie', staffCookie)
      .set('X-Portal', 'web')
      .send({ itemIds: [itemAnnA1()] })
      .expect(201);
    const hash = prev.body.items[0].payloadHash as string;

    const res = await request(app.getHttpServer())
      .post('/api/platform-push/dispatch')
      .set('Cookie', staffCookie)
      .set('X-Portal', 'web')
      .send({ channel: 'mock', itemIds: [itemAnnA1()], payloadHashes: [{ itemId: itemAnnA1(), payloadHash: hash }] })
      .expect(201);
    expect(res.body.channel).toBe('mock');
    expect(res.body.results[0]).toMatchObject({ itemId: itemAnnA1(), status: 'SUCCESS', attemptNo: 1 });
    expect(res.body.results[0].responseSnippet).toMatch(/^MOCK-/);

    // 留痕三重：台账行 + 监督日志（挂 fixture 项目）+ 审计行（resourceId=fixture 项目）
    const log = await prisma.platformPushLog.findFirst({ where: { channel: 'mock', itemId: itemAnnA1() } });
    expect(log).toMatchObject({ status: 'SUCCESS', projectId: projAId, projectCode: codeA, itemType: 'bid_notice' });
    expect(log!.payloadSha256).toBe(hash);
    const sup = await prisma.bidSupervisionLog.findFirst({ where: { projectId: projAId, action: '上级平台推送' } });
    expect(sup?.target).toBe(`${PREFIX}招标公告A1`);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'PLATFORM_PUSH', resourceId: projAId } });
    expect(audit?.resourceType).toBe('PlatformPush:mock');
  });

  it('同载荷重复 dispatch → 409 ALREADY_PUSHED（幂等三元组：通道+数据项+指纹）', async () => {
    const prev = await request(app.getHttpServer())
      .post('/api/platform-push/preview')
      .set('Cookie', staffCookie)
      .set('X-Portal', 'web')
      .send({ itemIds: [itemAnnA1()] })
      .expect(201);
    const hash = prev.body.items[0].payloadHash as string;
    await request(app.getHttpServer())
      .post('/api/platform-push/dispatch')
      .set('Cookie', staffCookie)
      .set('X-Portal', 'web')
      .send({ channel: 'mock', itemIds: [itemAnnA1()], payloadHashes: [{ itemId: itemAnnA1(), payloadHash: hash }] })
      .expect(409)
      .expect((res) => {
        // HttpExceptionFilter 全局标准化：结构化 itemIds 不上线（仅 unit 级 getResponse 可见），itemId 内嵌 error 文案
        expect(res.body.code).toBe('ALREADY_PUSHED');
        expect(res.body.error).toContain(itemAnnA1());
        expect(res.body.error).toContain('mock');
      });
  });

  it('指纹篡改 dispatch → 400 PAYLOAD_DRIFT（且不落任何台账行）', async () => {
    const prev = await request(app.getHttpServer())
      .post('/api/platform-push/preview')
      .set('Cookie', staffCookie)
      .set('X-Portal', 'web')
      .send({ itemIds: [itemAnnA2()] })
      .expect(201);
    const hash = prev.body.items[0].payloadHash as string;
    const tampered = '0'.repeat(64);
    expect(tampered).not.toBe(hash); // 篡改值 ≠ preview 指纹（保证负例真因是指纹比对而非格式）

    await request(app.getHttpServer())
      .post('/api/platform-push/dispatch')
      .set('Cookie', staffCookie)
      .set('X-Portal', 'web')
      .send({
        channel: 'mock', itemIds: [itemAnnA2()],
        payloadHashes: [{ itemId: itemAnnA2(), payloadHash: tampered }],
      })
      .expect(400)
      .expect((res) => {
        expect(res.body.code).toBe('PAYLOAD_DRIFT');
        expect(res.body.error).toContain(itemAnnA2()); // 同上：drift 明细内嵌 error 文案
      });
    // 漂移在留痕之前被拦——mock 通道对该项零台账行（hash 本尊后续仍可用）
    const rows = await prisma.platformPushLog.findMany({ where: { channel: 'mock', itemId: itemAnnA2() } });
    expect(rows).toHaveLength(0);
  });

  it('stub 通道（sc_province）dispatch → 501 CHANNEL_NOT_CONNECTED + STUB_REFUSED 台账行', async () => {
    const prev = await request(app.getHttpServer())
      .post('/api/platform-push/preview')
      .set('Cookie', staffCookie)
      .set('X-Portal', 'web')
      .send({ itemIds: [itemAnnA2()] })
      .expect(201);
    const hash = prev.body.items[0].payloadHash as string;

    await request(app.getHttpServer())
      .post('/api/platform-push/dispatch')
      .set('Cookie', staffCookie)
      .set('X-Portal', 'web')
      .send({ channel: 'sc_province', itemIds: [itemAnnA2()], payloadHashes: [{ itemId: itemAnnA2(), payloadHash: hash }] })
      .expect(501)
      .expect((res) => expect(res.body.code).toBe('CHANNEL_NOT_CONNECTED'));

    const log = await prisma.platformPushLog.findFirst({ where: { channel: 'sc_province', itemId: itemAnnA2() } });
    expect(log).toMatchObject({ status: 'STUB_REFUSED', projectId: projAId });
    expect(log!.errorMessage).toContain('未连通');
  });

  it('Phase 2 K1：STUB_REFUSED 不占坑——同载荷再 dispatch stub → 再 501（非 409）且台账两行 attemptNo 1/2', async () => {
    const prev = await request(app.getHttpServer())
      .post('/api/platform-push/preview')
      .set('Cookie', staffCookie)
      .set('X-Portal', 'web')
      .send({ itemIds: [itemAnnA2()] })
      .expect(201);
    const hash = prev.body.items[0].payloadHash as string;

    // 第二次 stub（同载荷）：应再次 501 而非 409——partial index 下 STUB_REFUSED 不占坑
    await request(app.getHttpServer())
      .post('/api/platform-push/dispatch')
      .set('Cookie', staffCookie)
      .set('X-Portal', 'web')
      .send({ channel: 'sc_province', itemIds: [itemAnnA2()], payloadHashes: [{ itemId: itemAnnA2(), payloadHash: hash }] })
      .expect(501)
      .expect((res) => expect(res.body.code).toBe('CHANNEL_NOT_CONNECTED'));

    const logs = await prisma.platformPushLog.findMany({
      where: { channel: 'sc_province', itemId: itemAnnA2() },
      orderBy: { attemptNo: 'asc' },
    });
    expect(logs.length).toBe(2);
    expect(logs.every((l) => l.status === 'STUB_REFUSED')).toBe(true);
    expect(logs.map((l) => l.attemptNo)).toEqual([1, 2]);
  });

  it('Phase 2 K2：PERFORMANCE_NOTICE 公告入 pending fulfillment 行 + 信封附履约事件', async () => {
    const itemId = `announcement:${annA3Id}`;
    const pending = await request(app.getHttpServer())
      .get(`/api/platform-push/pending?projectId=${projAId}`)
      .set('Cookie', staffCookie)
      .set('X-Portal', 'web')
      .expect(200);
    const row = (pending.body.items as any[]).find((i) => i.itemId === itemId);
    expect(row).toMatchObject({ itemType: 'fulfillment', ready: true });

    const prev = await request(app.getHttpServer())
      .post('/api/platform-push/preview')
      .set('Cookie', staffCookie)
      .set('X-Portal', 'web')
      .send({ itemIds: [itemId] })
      .expect(201);
    // 合同无履约事件（fixture 未造 ContractFulfillment）→ fulfillments 为空数组（键在，不缺省）
    expect(prev.body.items[0].envelope.fields.fulfillments).toEqual([]); // 键名=fulfillments（service :441）
  });

  it('offline export：EXPORTED + FileAsset(platform_push_package) 三件套 + 可下载 + 台账聚合', async () => {
    const prev = await request(app.getHttpServer())
      .post('/api/platform-push/preview')
      .set('Cookie', staffCookie)
      .set('X-Portal', 'web')
      .send({ itemIds: [itemAnnA2()] })
      .expect(201);
    const hash = prev.body.items[0].payloadHash as string;

    const res = await request(app.getHttpServer())
      .post('/api/platform-push/export')
      .set('Cookie', staffCookie)
      .set('X-Portal', 'web')
      .send({ itemIds: [itemAnnA2()], payloadHashes: [{ itemId: itemAnnA2(), payloadHash: hash }] })
      .expect(201);
    expect(res.body.channel).toBe('offline');
    const row = res.body.results[0];
    expect(row).toMatchObject({ itemId: itemAnnA2(), status: 'EXPORTED' });
    expect(row.packetAssetId).toBeTruthy();
    expect(row.downloadUrl).toContain('/api/upload/files/');

    // 文件包可下载（cookie 认证）且为结构化 JSON（packageType 锚）
    const dl = await request(app.getHttpServer())
      .get(row.downloadUrl)
      .set('Cookie', staffCookie)
      .set('X-Portal', 'web')
      .expect(200);
    expect(dl.body.packageType).toBe('PLATFORM_PUSH_PACKAGE');
    expect(dl.body.envelope.gbProcureCode).toBe(gb21);

    // FileAsset 三件套（MinIO 对象 + 元数据行，category 锚 fixture 项目目录）
    const asset = await prisma.fileAsset.findUnique({ where: { id: row.packetAssetId } });
    expect(asset).toMatchObject({ category: 'platform_push_package', mimeType: 'application/json' });
    expect(asset!.key).toMatch(new RegExp(`^platform-push/${projAId}/clarify-\\d+\\.json$`));

    // 台账聚合（status?projectId=）：本套件对项目 A 的三通道留痕全数在账
    const status = await request(app.getHttpServer())
      .get(`/api/platform-push/status?projectId=${projAId}`)
      .set('Cookie', staffCookie)
      .set('X-Portal', 'web')
      .expect(200);
    expect(status.body.summary).toMatchObject({ SUCCESS: 1, EXPORTED: 1, STUB_REFUSED: 2 }); // K1 e2e 多落一行 stub 重试
    const itemIds = (status.body.logs as { itemId: string }[]).map((l) => l.itemId);
    expect(itemIds).toEqual(expect.arrayContaining([itemAnnA1(), itemAnnA2()]));
  });

  it('not-ready 项：preview 与 dispatch 双闸 → 400 ITEM_NOT_READY', async () => {
    await request(app.getHttpServer())
      .post('/api/platform-push/preview')
      .set('Cookie', staffCookie)
      .set('X-Portal', 'web')
      .send({ itemIds: [itemContract()] })
      .expect(400)
      .expect((res) => {
        expect(res.body.code).toBe('ITEM_NOT_READY');
        // 同上：missing 明细内嵌 error 文案（「contract:<id> 缺 amount/signedAt」）
        expect(res.body.error).toContain(itemContract());
        expect(res.body.error).toContain('amount');
        expect(res.body.error).toContain('signedAt');
      });
    // dispatch 带伪指纹也先撞完整度闸（loadItems→assertNotReady 先于 hash 校验）
    await request(app.getHttpServer())
      .post('/api/platform-push/dispatch')
      .set('Cookie', staffCookie)
      .set('X-Portal', 'web')
      .send({ channel: 'mock', itemIds: [itemContract()], payloadHashes: [{ itemId: itemContract(), payloadHash: '0'.repeat(64) }] })
      .expect(400)
      .expect((res) => expect(res.body.code).toBe('ITEM_NOT_READY'));
  });

  it('赋码闸：无码项目发布关联公告 → 400 GB_CODE_REQUIRED；有码项目 → 201 放行', async () => {
    // 负例：relatedProjectCode 反查 BidProject.gbProcureCode 为空（WIN_NOTICE 避开招标公告时间预检，
    //       纯验赋码闸；aiSummary 直供绕开 LLM 摘要、notifyOnPublish=false 免站内信扩散）
    const body = {
      title: `${PREFIX}闸验证公告`, content: 'e2e 赋码闸',
      type: 'WIN_NOTICE', status: 'PUBLISHED', aiSummary: 'e2e', metadata: { notifyOnPublish: false },
    };
    await request(app.getHttpServer())
      .post('/api/announcements')
      .set('Cookie', staffCookie)
      .set('X-Portal', 'web')
      .send({ ...body, relatedProjectCode: codeB })
      .expect(400)
      .expect((res) => expect(res.body.code).toBe('GB_CODE_REQUIRED'));
    // 闸在落库之前——无孤儿公告行
    expect(await prisma.announcement.count({ where: { title: body.title } })).toBe(0);

    // 正例：同一请求指向有码项目 → 放行
    const ok = await request(app.getHttpServer())
      .post('/api/announcements')
      .set('Cookie', staffCookie)
      .set('X-Portal', 'web')
      .send({ ...body, relatedProjectCode: codeA })
      .expect(201);
    expect(ok.body.status).toBe('PUBLISHED');
    createdAnnouncementIds.push(ok.body.id);
  });
});
