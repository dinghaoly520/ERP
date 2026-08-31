// A-143 澄清在线答复 e2e（2026-08-28）
// 流程：staff 发起寻址澄清 → 供应商取列表（他司不可见）→ 绑证（sm-crypto 生成）→
//       取 payload → SM2 签名 → 提交 → 篡改签名负例 → 主持端核验 → 离线登记（负例+正例）
// 惯例（app 启动/loginAs）与 bid.e2e-spec.ts 同源；供应商登录=公司名/supplier@2026（种子口令规则）。
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const sm2 = require('sm-crypto').sm2;

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

interface BidderRow { id: string; supplierName: string; supplierId: string }

describe('A-143 澄清在线答复 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  /** :3005 会话（token_web）——项目列表/投标人列表（共享端点，公司隔离过滤） */
  let staffCookie: string[];
  /** :3007 会话（token_bid，经 :3006 expert 门户登录分流写入）——澄清端点为 bid 独占
   *  （port-routes BID_EXCLUSIVE_PATTERNS：/api/bid/projects/:id/clarifications 全方法 :3005 → 403） */
  let staffBidCookie: string[];

  // fixture：EVALUATING 项目 + 目标投标人（无 ACTIVE 证书——绑证走全新行，撤销不到既有演示证书）
  // + 另一家可登录投标人（列表隔离断言用）
  let projectId: string | undefined;
  let targetRow: BidderRow | undefined;
  let otherSupplierName: string | undefined;
  let originalSm2Pk: string | null = null;

  // 清理账本（失败中途也按已产生物回收）
  const createdClarificationIds: string[] = [];
  let boundCertSn: string | null = null;
  let certSupplierId: string | null = null;

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
    staffCookie = await loginAs(app, 'Swhi-CGZX-05', 'Swhi-CGZX-05@2026', 'web');
    // :3006 登录分流：非 bid_expert 角色写 token_bid（staff 在 expert 门户允许集内）——:3007 现场会话
    staffBidCookie = await loginAs(app, 'Swhi-CGZX-05', 'Swhi-CGZX-05@2026', 'expert');

    // 定位：seed EVALUATING 项目（hero/引大济岷演示项目 BID-1786934256839 等）中，
    // bidder 满足 Supplier.userId 关联可登录账号；目标行还须无 ACTIVE 证书。
    const evaluating = await prisma.bidProject.findMany({
      where: { stage: 'EVALUATING' },
      select: { id: true },
      orderBy: { updatedAt: 'desc' },
    });
    outer:
    for (const proj of evaluating) {
      const bidders = await prisma.bidSupplier.findMany({
        where: { projectId: proj.id, supplierId: { not: null } },
        select: { id: true, supplierName: true, supplierId: true },
      });
      const loginable: BidderRow[] = [];
      for (const b of bidders) {
        const supplier = await prisma.supplier.findUnique({
          where: { id: b.supplierId! },
          select: { userId: true },
        });
        if (!supplier?.userId) continue;
        const user = await prisma.user.findFirst({
          where: { id: supplier.userId, role: 'supplier', isActive: true },
          select: { id: true },
        });
        if (user) loginable.push({ id: b.id, supplierName: b.supplierName, supplierId: b.supplierId! });
      }
      if (loginable.length < 2) continue; // 需目标 + 另一家（隔离断言）
      for (const b of loginable) {
        const activeCert = await prisma.supplierCert.findFirst({
          where: { supplierId: b.supplierId, bindingStatus: 'ACTIVE' },
          select: { id: true },
        });
        if (activeCert) continue; // 不动既有 ACTIVE 证书（如 U盾全流程演示 SHD-B14EF038）
        const s = await prisma.supplier.findUnique({
          where: { id: b.supplierId },
          select: { sm2PublicKey: true },
        });
        projectId = proj.id;
        targetRow = b;
        originalSm2Pk = s?.sm2PublicKey ?? null;
        otherSupplierName = loginable.find((o) => o.id !== b.id)!.supplierName;
        break outer;
      }
    }
  });

  afterAll(async () => {
    if (createdClarificationIds.length > 0) {
      await prisma.bidClarification.deleteMany({ where: { id: { in: createdClarificationIds } } }).catch(() => {});
    }
    if (boundCertSn) {
      await prisma.supplierCert.deleteMany({ where: { certSn: boundCertSn } }).catch(() => {});
    }
    if (certSupplierId) {
      // 还原绑证副作用：Supplier.sm2PublicKey 回写原值（本 fixture 目标行原为 null）
      await prisma.supplier.update({
        where: { id: certSupplierId },
        data: { sm2PublicKey: originalSm2Pk },
      }).catch(() => {});
    }
    await app.close();
  });

  it('全链：发起→他司不可见→绑证→签名答复→篡改负例→主持核验→离线登记', async () => {
    expect(projectId).toBeTruthy();
    expect(targetRow).toBeTruthy();
    expect(otherSupplierName).toBeTruthy();

    // 1. staff 项目列表可见该 EVALUATING 项目（web 门户公司隔离内）
    const projects = await request(app.getHttpServer())
      .get('/api/bid/projects?stage=EVALUATING')
      .set('Cookie', staffCookie)
      .set('X-Portal', 'web')
      .expect(200);
    expect(Array.isArray(projects.body)).toBe(true);
    expect(projects.body.some((p: { id: string }) => p.id === projectId)).toBe(true);

    // 2. 投标人列表（取 BidSupplier 行 id 供发起寻址）
    const suppliers = await request(app.getHttpServer())
      .get(`/api/bid/projects/${projectId}/suppliers`)
      .set('Cookie', staffCookie)
      .set('X-Portal', 'web')
      .expect(200);
    const row = (suppliers.body as Array<{ id: string; supplierName: string }>)
      .find((s) => s.id === targetRow!.id);
    expect(row).toBeDefined();
    expect(row!.supplierName).toBe(targetRow!.supplierName);

    // 3. 发起寻址澄清（supplierId 传 BidSupplier 行 id；:3007 现场会话——澄清端点 bid 独占）
    const created = await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectId}/clarifications`)
      .set('Cookie', staffBidCookie)
      .set('X-Portal', 'bid')
      .send({
        type: 'clarification',
        question: 'e2e：请澄清报价是否含安装费',
        issuer: '评标委员会',
        supplierName: targetRow!.supplierName,
        supplierId: targetRow!.id,
      })
      .expect(201);
    const cid = created.body.id as string;
    expect(cid).toBeTruthy();
    createdClarificationIds.push(cid);
    // F3：后端把 BidSupplier 行 id 校验归属并转换为 Supplier.id 落库
    expect(created.body.supplierId).toBe(targetRow!.supplierId);
    expect(created.body.status).toBe('待回复');

    // 4. 供应商视角：本司可见待回复；他司投标人不可见
    const supplierCookie = await loginAs(app, targetRow!.supplierName, 'supplier@2026', 'supplier');
    const otherCookie = await loginAs(app, otherSupplierName!, 'supplier@2026', 'supplier');

    const mine = await request(app.getHttpServer())
      .get(`/api/supplier-portal/projects/${projectId}/bid-clarifications`)
      .set('Cookie', supplierCookie)
      .set('X-Portal', 'supplier')
      .expect(200);
    const mineRow = (mine.body as Array<{ id: string; status: string }>).find((c) => c.id === cid);
    expect(mineRow).toBeDefined();
    expect(mineRow!.status).toBe('待回复');

    const theirs = await request(app.getHttpServer())
      .get(`/api/supplier-portal/projects/${projectId}/bid-clarifications`)
      .set('Cookie', otherCookie)
      .set('X-Portal', 'supplier')
      .expect(200);
    expect((theirs.body as Array<{ id: string }>).some((c) => c.id === cid)).toBe(false);

    // 5. 绑证：生成密钥对 → 模拟 U盾枚举上报（DN 的 CN 须含注册企业名）
    const kp = sm2.generateKeyPairHex();
    const certSn = `E2E-A143-${Date.now()}`;
    const certDn = `CN=${targetRow!.supplierName}, O=${targetRow!.supplierName}, C=CN`;
    const bound = await request(app.getHttpServer())
      .post('/api/supplier-portal/profile/cert')
      .set('Cookie', supplierCookie)
      .set('X-Portal', 'supplier')
      .send({ certSn, certDn, publicKey: kp.publicKey, alg: 'SM2' })
      .expect(201);
    expect(bound.body.cert.certSn).toBe(certSn);
    expect(bound.body.cert.bindingStatus).toBe('ACTIVE');
    boundCertSn = certSn;
    certSupplierId = targetRow!.supplierId;

    const certs = await request(app.getHttpServer())
      .get('/api/supplier-portal/profile/cert')
      .set('Cookie', supplierCookie)
      .set('X-Portal', 'supplier')
      .expect(200);
    const active = (certs.body as Array<{ certSn: string; bindingStatus: string }>)
      .find((c) => c.certSn === certSn);
    expect(active?.bindingStatus).toBe('ACTIVE');

    // 6. 取 canonical payload → SM2 签名 → 提交
    const reply = 'e2e 答复：报价含安装与调试费用。';
    const pl = await request(app.getHttpServer())
      .post(`/api/supplier-portal/projects/${projectId}/bid-clarifications/${cid}/reply-payload`)
      .set('Cookie', supplierCookie)
      .set('X-Portal', 'supplier')
      .send({ reply, attachmentIds: [], certSn })
      .expect(201);
    expect(typeof pl.body.payload).toBe('string');
    expect((pl.body.payload as string).length).toBeGreaterThan(0);

    const signature = sm2.doSignature(pl.body.payload, kp.privateKey, { hash: true });
    const submitted = await request(app.getHttpServer())
      .post(`/api/supplier-portal/projects/${projectId}/bid-clarifications/${cid}/reply`)
      .set('Cookie', supplierCookie)
      .set('X-Portal', 'supplier')
      .send({ reply, attachmentIds: [], certSn, signature })
      .expect(201);
    expect(submitted.body.status).toBe('已回复');
    expect(submitted.body.replyChannel).toBe('online');
    // 签名只回摘要（algorithm/certSn/verifiedAt）；payload 全串与签名值不得回传
    expect(submitted.body.replySignature).toMatchObject({ algorithm: 'SM2/SM3', certSn });
    expect(submitted.body.replySignature.verifiedAt).toBeTruthy();
    expect(submitted.body.replySignature.payload).toBeUndefined();
    expect(submitted.body.replySignature.signature).toBeUndefined();

    // 7. 篡改签名负例：第二条澄清拿第一条的签名提交（签名与本条 payload 不符）→ 400
    const c2 = await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectId}/clarifications`)
      .set('Cookie', staffBidCookie)
      .set('X-Portal', 'bid')
      .send({
        type: 'clarification',
        question: 'e2e：第二条澄清（篡改签名负例与离线登记载体）',
        issuer: '评标委员会',
        supplierName: targetRow!.supplierName,
        supplierId: targetRow!.id,
      })
      .expect(201);
    createdClarificationIds.push(c2.body.id);
    await request(app.getHttpServer())
      .post(`/api/supplier-portal/projects/${projectId}/bid-clarifications/${c2.body.id}/reply`)
      .set('Cookie', supplierCookie)
      .set('X-Portal', 'supplier')
      .send({ reply, attachmentIds: [], certSn, signature })
      .expect(400)
      .expect((res) => expect(res.body.code).toBe('CLARIFICATION_REPLY_SIGNATURE_INVALID'));

    // 8. 主持端核验（重算 canonical + SM2 验签；:3007 现场会话）
    const verified = await request(app.getHttpServer())
      .post(`/api/bid/projects/${projectId}/clarifications/${cid}/verify-reply`)
      .set('Cookie', staffBidCookie)
      .set('X-Portal', 'bid')
      .expect(201);
    expect(verified.body.valid).toBe(true);
    expect(verified.body.certSn).toBe(certSn);
    expect(verified.body.bindingStatus).toBe('ACTIVE');

    // 9. 代录负例：type=clarification 不带 channel → 400（在线答复归供应商门户）
    await request(app.getHttpServer())
      .patch(`/api/bid/projects/${projectId}/clarifications/${c2.body.id}/reply`)
      .set('Cookie', staffBidCookie)
      .set('X-Portal', 'bid')
      .send({ reply: '试图代录' })
      .expect(400)
      .expect((res) => expect(res.body.code).toBe('ONLINE_REPLY_SUPPLIER_ONLY'));

    // 10. 离线登记正例：channel=offline + offlineReason
    const offline = await request(app.getHttpServer())
      .patch(`/api/bid/projects/${projectId}/clarifications/${c2.body.id}/reply`)
      .set('Cookie', staffBidCookie)
      .set('X-Portal', 'bid')
      .send({ reply: '供应商电话答复：确认含安装费', channel: 'offline', offlineReason: '电话沟通留痕' })
      .expect(200);
    expect(offline.body.replyChannel).toBe('offline');
    expect(offline.body.replyOfflineReason).toBe('电话沟通留痕');
    expect(offline.body.replySignature).toBeNull();
  });
});
