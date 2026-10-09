import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/** 登录并返回 cookie；带 X-Portal 以匹配按门户命名的 cookie */
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

describe('Supplier (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let supplierCookie: string[];
  let dupCreditCode: string;
  /** 注册会话 token 轨 e2e 信用代码（afterAll 清理对应账号） */
  let tokenCreditA: string;
  let tokenCreditB: string;
  /** A-94 投标草稿 DTO 校验临时项目（种子项目 deadline 均已过，须新建未来截标的 DOWNLOAD 项目） */
  let draftProjectId: string;
  const orphanUsername = `e2e-orph-${Date.now()}`;

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

    // 取 supplier1 的信用代码，用于注册重复测试
    const u = await prisma.user.findUnique({ where: { username_role: { username: '重庆蜀通岩土工程有限公司', role: 'supplier' } } });
    const s = u ? await prisma.supplier.findUnique({ where: { userId: u.id } }) : null;
    dupCreditCode = s?.creditCode || 'DUPLICATE00000000';

    supplierCookie = await loginAs(app, '重庆蜀通岩土工程有限公司', 'supplier@2026', 'supplier');

    // A-94 fixture：DOWNLOAD 阶段 + 未来截标（saveBidDraft 门控：stage∈{DOWNLOAD,SUBMIT} 且未过 deadline）
    const fixtureProject = await prisma.bidProject.create({
      data: {
        projectCode: `E2E-A94-${Date.now()}`,
        name: 'E2E A-94 投标草稿 DTO 校验临时项目',
        procurementMethod: '公开招标',
        openTime: new Date(Date.now() + 24 * 3600_000),
        deadline: new Date(Date.now() + 48 * 3600_000),
      },
    });
    draftProjectId = fixtureProject.id;
  });

  afterAll(async () => {
    // 级联清掉草稿 submission（SupplierBidSubmission.project onDelete: Cascade）
    if (draftProjectId) {
      await prisma.bidProject.delete({ where: { id: draftProjectId } }).catch(() => {});
    }
    await prisma.user.deleteMany({ where: { username: orphanUsername } }).catch(() => {});
    await prisma.user.deleteMany({ where: { username: { in: [tokenCreditA, tokenCreditB].filter(Boolean) } } }).catch(() => {});
    await app.close();
  });

  it('变更申请字段白名单：status 应被拒绝（400）', async () => {
    await request(app.getHttpServer())
      .post('/api/supplier-portal/change-requests')
      .set('Cookie', supplierCookie)
      .set('X-Portal', 'supplier')
      .send({ fieldName: 'status', fieldLabel: '状态', newValue: 'APPROVED', reason: '尝试提权' })
      .expect(400);
  });

  it('变更申请字段白名单：userId 应被拒绝（400）', async () => {
    await request(app.getHttpServer())
      .post('/api/supplier-portal/change-requests')
      .set('Cookie', supplierCookie)
      .set('X-Portal', 'supplier')
      .send({ fieldName: 'userId', fieldLabel: '用户', newValue: 'x', reason: 'x' })
      .expect(400);
  });

  it('供应商门户身份由登录态决定：资质接口返回自己的数据（200）', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/supplier-portal/qualifications')
      .set('Cookie', supplierCookie)
      .set('X-Portal', 'supplier')
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('注册失败不留下孤立 user（重复信用代码→400，新用户名不存在）', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/supplier/register')
      .set('X-Portal', 'public')
      .send({
        companyId: (await prisma.company.findFirst({ where: {}, select: { id: true } }))?.id,
        name: 'E2E重复信用代码公司',
        creditCode: dupCreditCode,
        enterpriseType: '有限责任公司',
        legalPerson: '张三',
        legalPersonIdCard: '510104199001011234', // 注册 2.0 必填（18 位）
        registeredAddress: '测试地址',
        businessScope: '测试范围',
        username: orphanUsername,
        displayName: '孤儿测试',
        password: 'Test1234', // 注册 2.0 口令强度（≥8 位含字母数字）
        email: 'orph@test.com',
        registrationPhone: '13800000000', // P1-13 手机验证必填（SMS_DEBUG_BYPASS 下 123456 直接过）
        registrationCode: '123456',
        contacts: [{ name: '联系人', phone: '13800000000', idCard: '510104199001015678', isPrimary: true }],
        qualifications: [{ type: '营业执照', name: '企业法人营业执照', fileUrl: '/api/upload/files/e2e-orphan-license' }],
        tags: ['物资供应', '工程服务'],
      })
      .expect(400);
    // 应是信用代码重复导致的业务错误（验证码 bypass 通过后到达重复分支）
    expect(res.body.code).toBe('DUPLICATE_CREDIT_CODE');

    // 关键：失败后 user 表不应留下孤立记录
    const orphan = await prisma.user.findUnique({ where: { username_role: { username: orphanUsername, role: 'supplier' } } });
    expect(orphan).toBeNull();
  });

  // ── 注册会话 token 轨（2026-10-09）：步骤 0 验证一次换发 token，上传与注册全程凭 token ──

  it('注册会话 token 轨：验证换发 token → 凭 token 上传附件 → 带 token 注册成功，且 token 一次性', async () => {
    const phone = '13800000001';
    const t = Date.now().toString().slice(-13); // 13 位时间戳，信用代码 18 位可重跑
    tokenCreditA = `9151${t}X`;
    tokenCreditB = `9151${t}Y`;

    // 1. 验证消费短信码（bypass）并换发注册会话 token
    const verify = await request(app.getHttpServer())
      .post('/api/verification/verify-registration-code')
      .set('X-Portal', 'public')
      .send({ phone, code: '123456' })
      .expect(201);
    expect(String(verify.body.token)).toMatch(/^[0-9a-f]{64}$/);
    const token = verify.body.token as string;

    // 2. 凭 token 上传注册附件（不携带 phone+code）
    const upload = await request(app.getHttpServer())
      .post('/api/upload/registration')
      .set('X-Portal', 'public')
      .field('token', token)
      .field('category', 'qualification')
      .attach('file', Buffer.from('%PDF-1.7\ne2e token track license'), {
        filename: 'license.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    const fileUrl = `/api/upload/files/${upload.body.id}`;

    const base = {
      companyId: (await prisma.company.findFirst({ where: {}, select: { id: true } }))?.id,
      name: 'E2E Token 轨注册公司',
      creditCode: tokenCreditA,
      enterpriseType: '有限责任公司',
      legalPerson: '王五',
      legalPersonIdCard: '510104198808080001',
      registeredAddress: '成都市高新区',
      businessScope: '水利工程',
      displayName: 'E2E Token 轨',
      password: 'Test1234',
      registrationPhone: phone,
      registrationCode: '123456', // bypass 码；token 轨时不再消费
      registrationToken: token,
      contacts: [{ name: '联系人甲', phone, idCard: '510104198808080002', isPrimary: true }],
      qualifications: [{ type: '营业执照', name: '企业法人营业执照', fileUrl }],
      tags: ['物资供应', '工程服务'],
    };

    // 3. 带 token 注册成功（SMS 码记录早已消费，不依赖其存活——修复点）
    await request(app.getHttpServer())
      .post('/api/supplier/register')
      .set('X-Portal', 'public')
      .send(base)
      .expect(201);
    expect(await prisma.supplier.findUnique({ where: { creditCode: tokenCreditA } })).toBeTruthy();

    // 4. token 一次性：注册成功后再用同 token → 400 REGISTRATION_SESSION_EXPIRED
    const res = await request(app.getHttpServer())
      .post('/api/supplier/register')
      .set('X-Portal', 'public')
      .send({ ...base, creditCode: tokenCreditB })
      .expect(400);
    expect(res.body.code).toBe('REGISTRATION_SESSION_EXPIRED');
  });

  // ── A-94：投标草稿/递交 DTO 服务端格式校验 ──

  it('A-94：非法报价 bidPrice:"abc" 保存草稿 → 400（DTO 格式校验）', async () => {
    await request(app.getHttpServer())
      .post(`/api/supplier-portal/bid-submissions/${draftProjectId}/draft`)
      .set('Cookie', supplierCookie)
      .set('X-Portal', 'supplier')
      .send({ bidPrice: 'abc', deliveryPeriod: '90 日历天' })
      .expect(400);
  });

  it('A-94：非法报价 bidPrice:"12,600" 递交 → 400（SubmitBidDto 同一格式闸门）', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/supplier-portal/bid-submissions/${draftProjectId}/submit`)
      .set('Cookie', supplierCookie)
      .set('X-Portal', 'supplier')
      .send({ bidPrice: '12,600' })
      .expect(400);
    // 区分管道格式 400 与递交期业务 400：业务闸门返回专属 code（HOST_DECRYPT_CONSENT_REQUIRED/
    // DEADLINE_PASSED 等）；ValidationPipe 400 经 HttpExceptionFilter 展开 class-validator 数组详情
    // （c3cb999f 修 filter bug：数组 message 此前被 nested-object 分支吞成 'Bad Request Exception'，
    //  校验文案不可见；现 code=VALIDATION_ERROR、文案上线，故可直接断「投标报价」格式闸门文案）
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.error).toContain('投标报价须为不超过 4 位小数的数字');
  });

  it('A-94：合法草稿全字段（含 splitFiles/clientDeks）→ 201 且回读字段在（whitelist 不剥落、空串转未填）', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/supplier-portal/bid-submissions/${draftProjectId}/draft`)
      .set('Cookie', supplierCookie)
      .set('X-Portal', 'supplier')
      .send({
        bidPrice: '1260.5',
        deliveryPeriod: '90 日历天',
        qualityCommitment: '合格',
        technicalFile: '技术标说明',
        businessFile: '', // 空串 → 未填（DTO @Transform）
        coverLetter: '投标函',
        // P0-1 前端拆分模型 + E2EE 密钥表：透传到服务层（嵌套归一/加密在服务层），不得被 whitelist 剥落致 400/丢失
        splitFiles: { tech: { assetId: 'a1' }, biz: { assetId: 'a2' }, other: { assetId: 'a3' } },
        clientDeks: { a1: 'aa:bb:cc' },
      })
      .expect(201);
    expect(res.body.status).toBe('draft');

    // 本人回读：bidPrice 经 seal/open 往返应还原明文（未剥落/未损坏）
    const read = await request(app.getHttpServer())
      .get(`/api/supplier-portal/bid-submissions/${draftProjectId}`)
      .set('Cookie', supplierCookie)
      .set('X-Portal', 'supplier')
      .expect(200);
    expect(read.body.bidPrice).toBe('1260.5');
    expect(read.body.deliveryPeriod).toBe('90 日历天');
    expect(read.body.qualityCommitment).toBe('合格');
    expect(read.body.coverLetter).toBe('投标函');
    expect(read.body.businessFile).toBeNull(); // 空串被转未填
  });

  it('A-94：空串报价 → 201 视为未填（bidPrice 落 null，其余草稿字段不受影响）', async () => {
    await request(app.getHttpServer())
      .post(`/api/supplier-portal/bid-submissions/${draftProjectId}/draft`)
      .set('Cookie', supplierCookie)
      .set('X-Portal', 'supplier')
      .send({ bidPrice: '' })
      .expect(201);

    const read = await request(app.getHttpServer())
      .get(`/api/supplier-portal/bid-submissions/${draftProjectId}`)
      .set('Cookie', supplierCookie)
      .set('X-Portal', 'supplier')
      .expect(200);
    expect(read.body.bidPrice).toBeNull();
    // 未提交的字段不覆盖既有草稿（Prisma undefined 跳过）
    expect(read.body.deliveryPeriod).toBe('90 日历天');
  });
});
