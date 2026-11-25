import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * 公告「引用采购文件」源键闸（2026-11-24 审计第 1 处，封 P1-2 后半）。
 *
 * metadata.selectedTenderObjectKey 由客户端写入。修复前它被原样拿去按任意键读对象存储、
 * 失败再裸读本地路径，读到的东西会被加密成「公开范围」的招标文件；修复后只认 PMI 阶段附件键，
 * 不合规的键被拒，而发布链路对这一步是尽力而为——公告照常发布，只是没有招标文件。
 *
 * 只能在隔离 e2e 环境跑（独立库 + Redis 6390 + 独立桶）：本用例会真实发布一条招标公示。
 */
const MARK = 'E2E招标文件源键-';

/**
 * 发布前护栏：本用例会真实发布一条招标公示，只能落在隔离 e2e 库上。
 *
 * 必须在启动 AppModule 之前判——AppModule 一启动，定时任务等就已经对着 .env 指向的库跑起来了，
 * 事后再判只是「不发布」，拦不住启动本身的副作用（2026-11-25 审查）。这里用一个裸的 Prisma
 * 客户端问「这个进程会连到哪个库」，它与应用用的是同一份连接配置。
 *
 * CI（环境变量 CI=true）在一次性容器库上跑，库名叫 water_erp、与开发实时库同名，靠 CI 标记放行；
 * 本机只认隔离 e2e 库 water_erp_e2e（2026-11-24 有过验证脚本忘带环境变量、把公告真实发出去的事故）。
 */
async function assertWillConnectToE2eDatabase(): Promise<void> {
  const probe = new PrismaClient();
  try {
    const rows = await probe.$queryRawUnsafe<{ db: string }[]>('SELECT current_database() AS db');
    const db = rows[0]?.db ?? '';
    if (process.env.CI !== 'true' && db !== 'water_erp_e2e') {
      throw new Error(
        `本用例会真实发布公告，只允许在隔离 e2e 库 water_erp_e2e 上跑；当前进程会连到「${db || '无法确定'}」，已在启动应用之前中止`,
      );
    }
  } finally {
    await probe.$disconnect();
  }
}

describe('公告「引用采购文件」源键闸 (e2e)', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaService | undefined;
  let adminCookie: string[];
  let projectId: string | undefined;

  beforeAll(async () => {
    // 护栏在一切之前：见 assertWillConnectToE2eDatabase
    await assertWillConnectToE2eDatabase();

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Portal', 'web')
      .send({ username: 'Swhi-CGZX-admin', password: 'Swhi-CGZX-admin@2026' });
    adminCookie = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'] : [res.headers['set-cookie']];
    expect(adminCookie.join()).toContain('token_web=');
  });

  afterAll(async () => {
    // 启动失败时 prisma 可能还没赋值：收尾不能再抛一个错把真正的失败原因盖住，也不能因此漏关应用
    try {
      if (!prisma) return;
      await prisma.notification.deleteMany({ where: { title: { contains: MARK } } }).catch(() => {});
      await prisma.announcement.deleteMany({ where: { title: { startsWith: MARK } } }).catch(() => {});
      if (projectId) {
        await prisma.bidSupervisionLog.deleteMany({ where: { projectId } }).catch(() => {});
        await prisma.bidSupplier.deleteMany({ where: { projectId } }).catch(() => {});
        await prisma.bidExpert.deleteMany({ where: { projectId } }).catch(() => {});
        await prisma.bidProject.delete({ where: { id: projectId } }).catch(() => {});
      }
    } finally {
      if (app) await app.close();
    }
  });

  it('selectedTenderObjectKey 越界：公告发布成功，但没有招标文件', async () => {
    if (!app || !prisma) throw new Error('应用未启动');
    // 越界键指向一个真实存在、但无关且不含密钥的文件：jest 的 cwd 是 apps/api，../package.json 就是它。
    // 这样修复前这条用例会失败；不用 .env，免得把密钥带进测试产物。
    const sourceKey = '../package.json';
    const fileAssetsBefore = await prisma.fileAsset.count({ where: { category: 'bid_document' } });

    // 先建一个一次性项目：公告挂到它上面，就不会走「公告直建项目」再带出一套采购项目数据
    const project = await request(app.getHttpServer())
      .post('/api/bid/projects')
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .send({
        name: `${MARK}项目-${Date.now()}`,
        procurementMethod: '公开招标',
        openTime: '2099-12-31T09:00:00Z',
        deadline: '2099-12-31T08:50:00Z', // 截标↔开标间隔 10 分钟
      })
      .expect(201);
    projectId = project.body.id;

    const res = await request(app.getHttpServer())
      .post('/api/announcements')
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .send({
        title: `${MARK}${Date.now()}`,
        content: '<p>e2e</p>',
        type: 'BID_NOTICE',
        status: 'PUBLISHED',
        relatedProjectCode: project.body.projectCode,
        aiSummary: 'e2e',                     // 给定摘要，跳过 LLM
        metadata: {
          notifyOnPublish: false,             // 关闭发布 fan-out，不向供应商刷站内信
          selectedTenderObjectKey: sourceKey, // 审计 P1-2 后半：越界键
          selectedTenderFileName: 'x.docx',
          selectedTenderMimeType: 'application/msword',
        },
      })
      .expect(201);
    const announcementId: string = res.body.id;

    // 生成招标文件这一步失败不阻塞发布（调用点尽力而为），但绝不能把越界读到的内容做成文件
    expect(await prisma.bidDocument.findUnique({ where: { announcementId } })).toBeNull();
    expect(await prisma.fileAsset.count({ where: { category: 'bid_document' } })).toBe(fileAssetsBefore);
  });
});
