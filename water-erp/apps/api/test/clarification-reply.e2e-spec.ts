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
  /** 夹具项目名前缀：beforeAll 自建、afterAll 删除；按前缀识别并清理上次 --forceExit 的遗留 */
  const FIXTURE_NAME_PREFIX = 'E2E-A143-澄清答复夹具项目';
  /** 其他套件在用的演示供应商账号——不选作投标人，防绑证副作用外溢 */
  const EXCLUDED_SUPPLIERS = new Set([
    '重庆蜀通岩土工程有限公司', '四川水发建设有限公司', '中科院成都信息技术股份有限公司',
    '四川省通信产业服务有限公司', '成都华西物资供应有限公司',
  ]);

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

    // 自建夹具（2026-11-16 起种子只留账号/供应商/专家，库内不再有评标中的演示项目可挑；原先是在
    // 共享演示项目里挑一个、事后还原主持人指派）：评标中项目——归属 staff 公司（web 公司隔离内
    // 可见）、直接指派给该 staff（澄清 A 档端点的 AssignedHostGuard 须被指派人/admin 放行，
    // 2026-11-19 裁定2）+ 两名可登录的种子供应商作投标人（公司名 / supplier@2026）；
    // 目标投标人须无 ACTIVE 证书（绑证走全新行，撤销不到既有证书）。
    const staffUser = await prisma.user.findFirst({
      where: { username: 'Swhi-CGZX-05' },
      select: { id: true, companyId: true },
    });
    expect(staffUser?.companyId).toBeTruthy();

    // 幂等清理上次 --forceExit 可能遗留的夹具：遗留证书 → 项目（澄清与投标人随项目级联删除）
    await prisma.supplierCert.deleteMany({ where: { certSn: { startsWith: 'E2E-A143-' } } });
    await prisma.bidProject.deleteMany({ where: { name: { startsWith: FIXTURE_NAME_PREFIX } } });

    // 「可登录」以实际试登录为准（公司名 / supplier@2026 登进供应商门户），不能只看有无关联账号：
    // 全量顺序下前面套件会在库里留下有关联账号、但口令并非种子口令的供应商行（如 bid-v3 套件的
    // 「e2e-v3供应商」），只按关联挑会让「他司」那一步登录失败（2026-11-25 全量复跑实录）。
    const candidates = await prisma.supplier.findMany({
      where: { user: { role: 'supplier', isActive: true, isFrozen: false } },
      select: { id: true, name: true, sm2PublicKey: true, certs: { where: { bindingStatus: 'ACTIVE' }, select: { id: true } } },
      orderBy: { name: 'asc' },
    });
    const loginable: Array<{ id: string; name: string; sm2PublicKey: string | null; hasActiveCert: boolean }> = [];
    for (const s of candidates) {
      // 他套件的演示账号与自建账号（e2e 前缀）不入夹具
      if (!s.name || EXCLUDED_SUPPLIERS.has(s.name) || /^e2e/i.test(s.name)) continue;
      const tried = await loginAs(app, s.name, 'supplier@2026', 'supplier');
      if (!tried.join().includes('token_supplier=')) continue;
      loginable.push({ id: s.id, name: s.name, sm2PublicKey: s.sm2PublicKey, hasActiveCert: s.certs.length > 0 });
      if (loginable.length >= 2 && loginable.some((x) => !x.hasActiveCert)) break;
    }
    const target = loginable.find((x) => !x.hasActiveCert); // 目标：无 ACTIVE 证书
    const other = loginable.find((x) => x.id !== target?.id);
    expect(target).toBeTruthy();
    expect(other).toBeTruthy();

    const stamp = Date.now();
    const project = await prisma.bidProject.create({
      data: {
        projectCode: `E2E-A143-${stamp}`, name: `${FIXTURE_NAME_PREFIX}-${stamp}`, procurementMethod: '公开招标',
        openTime: new Date(stamp - 3600_000), deadline: new Date(stamp - 7200_000), stage: 'EVALUATING',
        companyId: staffUser!.companyId!, assignedHostUserId: staffUser!.id,
      },
    });
    projectId = project.id;
    const fixtureProjectId = project.id;
    const mkBidder = (s: { id: string; name: string }) =>
      prisma.bidSupplier.create({
        data: { projectId: fixtureProjectId, supplierId: s.id, supplierName: s.name, submitStatus: '已提交', decryptStatus: 'SUCCESS', confirmStatus: 'CONFIRMED' },
      });
    const targetBidder = await mkBidder(target!);
    await mkBidder(other!);
    targetRow = { id: targetBidder.id, supplierName: target!.name, supplierId: target!.id };
    originalSm2Pk = target!.sm2PublicKey ?? null;
    otherSupplierName = other!.name;
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
    // 自建夹具项目整个删除（澄清记录、投标人随项目级联）。项目归本套件所有，不再有「还原共享演示
    // 项目主持人指派」一步；删除失败不吞错——残留虽由下次运行的幂等清理接手，但必须可见
    if (projectId) {
      await prisma.bidProject.deleteMany({ where: { id: projectId } });
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
