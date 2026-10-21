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

// 补正全链（文件末尾 describe）会真正触发发码端点 POST /supplier/register/correction/request。
// 本机 .env 可能是 SMS_PROVIDER=aliyun（真短信）或未配 http 网关 endpoint（发送必失败）——
// 测试进程显式切 console stub（同 setup-throttle.ts「测试进程自洽」思路，Prisma .env 加载不覆盖已有值）。
// 仅影响本测试进程；生产 ConsoleSmsProvider 对 NODE_ENV=production 双保险拒用。
process.env.SMS_PROVIDER = 'console';

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
    // 2026-10-16（3c54e24d）起重复信用代码分流为「他司已注册引导走加入」——业务错误码已改；
    // 关键断言不变：失败后 user 表不留孤立记录
    expect(res.body.code).toBe('ACCOUNT_EXISTS_JOIN_INSTEAD');

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

  // ── 注册驳回/补正全链（2026-10-14 Task 9）：注册 → 退回 → 补正回填 → 重提 → 驳回清洗 → 壳重开 ──

  describe('供应商注册驳回/补正全链 (e2e)', () => {
    const t = Date.now().toString().slice(-13);
    const creditCode = `9151${t}X`;
    const seq = Date.now().toString().slice(-8);
    // 唯一手机号（User.phoneIdx @@unique 全局唯一）：purge 清 User.phoneIdx + contacts 行后，
    // 壳重开第二次注册复用同号不撞唯一约束；法人/联系人身份证号同样按运行期唯一化（防上轮残留挡查重）
    const phone = `139${seq}`;
    const legalPersonIdCard = `5101041990${seq}`;
    const contactIdCard = `5101041991${seq}`;
    const supplierName = 'E2E补正链公司';

    /** 归属公司：专建一家无 staff/leader 的公司——assertStageApprover 在「公司完全无办公账号」时
     *  回退平台 admin 代审（2026-10-09 方案 A），种子公司均有 staff/leader（admin 审 STAFF 级会被
     *  403 REVIEW_STAGE_MISMATCH），故退回/驳回两步走 admin 真实审批端点须挂在本测试自建公司下 */
    let chainCompanyId = '';
    let adminCookie: string[] = [];
    let supplierId = '';
    let chainUserId = '';

    beforeAll(async () => {
      const company = await prisma.company.create({ data: { name: `E2E补正链链路归属公司${t}` } });
      chainCompanyId = company.id;
      adminCookie = await loginAs(app, 'Swhi-CGZX-admin', 'Swhi-CGZX-admin@2026', 'web');
    });

    afterAll(async () => {
      // SupplierApprovalRecord.supplierId onDelete: Restrict——先删留痕再删 User（级联 Supplier/联系人/资质/通知）
      const s = await prisma.supplier.findUnique({ where: { creditCode } }).catch(() => null);
      if (s) {
        await prisma.supplierApprovalRecord.deleteMany({ where: { supplierId: s.id } }).catch(() => {});
        await prisma.user.deleteMany({ where: { id: s.userId } }).catch(() => {});
      }
      if (chainCompanyId) {
        await prisma.company.deleteMany({ where: { id: chainCompanyId } }).catch(() => {});
      }
    });

    /** 注册页附件上传（旧轨 phone+code，SMS_DEBUG_BYPASS 下 123456 非消费校验直过）：
     *  register() 会校验 fileUrl 指向真实 FileAsset 且 key 落在本手机号注册命名空间内。 */
    async function uploadLicense(): Promise<string> {
      const up = await request(app.getHttpServer())
        .post('/api/upload/registration')
        .set('X-Portal', 'public')
        .field('phone', phone)
        .field('code', '123456')
        .field('category', 'qualification')
        .attach('file', Buffer.from('%PDF-1.7\ne2e correction chain license'), {
          filename: 'license.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);
      return `/api/upload/files/${up.body.id}`;
    }

    const registerPayload = (fileUrl: string, name: string) => ({
      companyId: chainCompanyId,
      name,
      creditCode,
      enterpriseType: '有限责任公司',
      legalPerson: '赵六',
      legalPersonIdCard,
      registeredAddress: '成都市高新区',
      businessScope: '水利工程',
      displayName: '赵六',
      password: 'Test1234',
      email: 'corr-e2e@test.com',
      registrationPhone: phone,
      registrationCode: '123456',
      contacts: [{ name: '赵六', phone, idCard: contactIdCard, isPrimary: true }],
      qualifications: [{ type: '营业执照', name: '企业法人营业执照', fileUrl }],
      tags: ['物资供应', '工程服务'],
    });

    it('注册 → 退回 → 补正回填 → 重提 → 驳回清洗 → 壳重开', async () => {
      // 1. 注册：先传营业执照（真实附件轨）再提交 → 201，PENDING / STAFF
      const fileUrl = await uploadLicense();
      const reg = await request(app.getHttpServer())
        .post('/api/supplier/register')
        .set('X-Portal', 'public')
        .send(registerPayload(fileUrl, supplierName))
        .expect(201);
      supplierId = reg.body.supplier.id;
      chainUserId = reg.body.user.id;
      expect(await prisma.supplier.findUnique({ where: { creditCode } })).toMatchObject({
        status: 'PENDING',
        reviewStage: 'STAFF',
      });

      // 2. 退回（真实审批端点：admin 审 STAFF 级，PENDING→RETURNED；退回不重置 reviewStage）
      const returned = await request(app.getHttpServer())
        .post(`/api/supplier/${supplierId}/return`)
        .set('Cookie', adminCookie)
        .set('X-Portal', 'web')
        .send({ reason: '资质材料不清晰' })
        .expect(201);
      expect(returned.body.status).toBe('RETURNED');
      expect(returned.body.returnReason).toBe('资质材料不清晰');
      expect(returned.body.reviewStage).toBe('STAFF');

      // 3. request 补正：向主联系人手机发码（SMS_PROVIDER=console，不打真短信）
      const req = await request(app.getHttpServer())
        .post('/api/supplier/register/correction/request')
        .set('X-Portal', 'public')
        .send({ name: supplierName, creditCode })
        .expect(201);
      expect(req.body.maskedPhone).toBeTruthy();

      // 4. verify 换发一次性补正 token（bypass 码 123456）
      const verify = await request(app.getHttpServer())
        .post('/api/supplier/register/correction/verify')
        .set('X-Portal', 'public')
        .send({ name: supplierName, creditCode, code: '123456' })
        .expect(201);
      const token = verify.body.correctionToken as string;
      expect(token).toMatch(/^[0-9a-f]{64}$/);

      // 5. draft 回填：退回原因 + 已填资料（PII 解封）完整带回
      const draft = await request(app.getHttpServer())
        .get(`/api/supplier/register/correction/draft?token=${token}&name=${encodeURIComponent(supplierName)}&creditCode=${creditCode}`)
        .set('X-Portal', 'public')
        .expect(200);
      expect(draft.body.returnReason).toBe('资质材料不清晰');
      expect(draft.body.legalPerson).toBe('赵六');
      expect(draft.body.contacts[0].phone).toBe(phone);

      // 6. submit 重提（改公司简介；fileUrl 复用 register 已认领的旧附件=keepIds 保留不清理）
      const submit = await request(app.getHttpServer())
        .post('/api/supplier/register/correction/submit')
        .set('X-Portal', 'public')
        .send({
          token,
          name: supplierName,
          creditCode,
          companyId: chainCompanyId,
          enterpriseType: '有限责任公司',
          legalPerson: '赵六',
          legalPersonIdCard,
          registeredAddress: '成都市高新区',
          businessScope: '水利工程',
          companyProfile: '已补正',
          contacts: [{ name: '赵六', phone, idCard: contactIdCard, isPrimary: true }],
          qualifications: [{ type: '营业执照', name: '企业法人营业执照', fileUrl }],
          tags: ['物资供应', '工程服务'],
        })
        .expect(201);
      expect(submit.body.success).toBe(true);
      expect(await prisma.supplier.findUnique({ where: { creditCode } })).toMatchObject({
        status: 'PENDING',
        reviewStage: 'STAFF', // 补正后回到被退回的那一级
        companyProfile: '已补正',
      });

      // 7. 驳回（真实 reject 端点触发 purgeRejectedSupplier 数据最小化清洗）
      const rejected = await request(app.getHttpServer())
        .post(`/api/supplier/${supplierId}/reject`)
        .set('Cookie', adminCookie)
        .set('X-Portal', 'web')
        .send({ reason: '材料不实' })
        .expect(201);
      expect(rejected.body.status).toBe('REJECTED');
      expect(rejected.body.rejectReason).toBe('材料不实');

      // 7a. 清洗断言：业务字段置空、子表删空，壳（name/creditCode/supplierNo）保留
      const shell = await prisma.supplier.findUnique({
        where: { creditCode },
        include: { contacts: true, qualifications: true },
      });
      expect(shell).not.toBeNull();
      expect(shell!.status).toBe('REJECTED');
      expect(shell!.enterpriseType).toBe('');
      expect(shell!.legalPerson).toBe('');
      expect(shell!.registeredAddress).toBe('');
      expect(shell!.businessScope).toBe('');
      expect(shell!.legalPersonIdCard).toBeNull();
      expect(shell!.companyProfile).toBeNull();
      expect(shell!.tags).toEqual([]);
      expect(shell!.contacts).toHaveLength(0);
      expect(shell!.qualifications).toHaveLength(0);
      expect(shell!.name).toBe(supplierName);
      expect(shell!.creditCode).toBe(creditCode);
      expect(shell!.supplierNo).toBeTruthy();

      // 7b. User 敏感列清洗：passwordHash=null（登录天然拒绝）、phone/email 置空
      const shellUser = await prisma.user.findUnique({ where: { id: chainUserId } });
      expect(shellUser!.passwordHash).toBeNull();
      expect(shellUser!.phoneIdx).toBeNull();
      expect(shellUser!.email).toBeNull();

      // 7c. 审批快照最小化：RETURNED + REJECTED 两条留痕均改写为 purged 快照
      const records = await prisma.supplierApprovalRecord.findMany({ where: { supplierId } });
      expect(records.length).toBeGreaterThanOrEqual(2);
      for (const r of records) {
        expect((r.snapshot as { purged?: boolean }).purged).toBe(true);
      }

      // 7d. 查重放行：REJECTED 壳命中 creditCodeStatus='REJECTED'（前端判非阻塞、可重注册）
      const dup = await request(app.getHttpServer())
        .get(`/api/supplier/register/check-duplicate?creditCode=${creditCode}`)
        .set('X-Portal', 'public')
        .expect(200);
      expect(dup.body.creditCode).toBe(true);
      expect(dup.body.creditCodeStatus).toBe('REJECTED');

      // 8. 壳重开：purge 已删原附件（DB+MinIO），须重传执照；同信用代码+同手机号再注册 → 201（非 DUPLICATE_CREDIT_CODE）
      const reopenedFile = await uploadLicense();
      const reopened = await request(app.getHttpServer())
        .post('/api/supplier/register')
        .set('X-Portal', 'public')
        .send(registerPayload(reopenedFile, `${supplierName}（重开）`))
        .expect(201);
      // 复用原 User+Supplier 行原位覆盖（supplierNo 不变），从首级 STAFF 重新起审
      expect(reopened.body.supplier.id).toBe(supplierId);
      const reopenedRow = await prisma.supplier.findUnique({ where: { creditCode } });
      expect(reopenedRow).toMatchObject({
        status: 'PENDING',
        reviewStage: 'STAFF',
        rejectReason: null,
        returnReason: null,
        name: `${supplierName}（重开）`,
        supplierNo: shell!.supplierNo,
      });
    });
  });

  // ── 供应商多公司归属（SupplierCompanyLink，2026-10-16 spec）：唯一通道=供应商自主申请，
  //    走该公司三级审批（staff 初审 → leader 复审 → admin 终审），任一级可驳回。──
  //
  // 种子锚点：供应商「重庆蜀通岩土工程有限公司」主归属=设计院本部（co-swhi-sjy，backfill）。
  // 三级审批的级权限口径（SupplierLinkService.assertStageApprover）：
  //   STAFF  → 本公司 staff；无 staff 则本公司 leader；二者皆无则 admin（上浮代审）
  //   LEADER → 本公司 leader；无 leader 则 admin
  //   ADMIN  → 仅 admin
  // 故驱动真三级须选「有 staff+leader」的公司作 B/C：
  //   B = 四川水发建设有限公司（co-swhi-js）：staff Swhi-JS-02、leader Swhi-JS-01 —— 全链通过
  //   C = 四川水发投资有限公司（co-swhi-tz）：staff Swhi-TZ-02 —— 驳回路径
  //   D = 四川省水利发展集团有限公司（co-swdg-jt）：无 staff/leader —— 注册查重引导（供应商无 link）
  describe('供应商多公司归属（SupplierCompanyLink e2e）', () => {
    let sup: { id: string; companyId: string | null; creditCode: string | null };
    let bCompanyId: string;
    let cCompanyId: string;
    let dCompanyId: string;
    // ApplyCompanyLinkDto.companyId 为 @IsUUID()，而种子公司 id 是 'co-*' 非 UUID——申请须走 companyName（与 :3004 前端同口径）
    const bCompanyName = '四川水发建设有限公司';
    const cCompanyName = '四川水发投资有限公司';
    let jsStaffCookie: string[]; // Swhi-JS-02 staff@建设
    let jsLeaderCookie: string[]; // Swhi-JS-01 leader@建设
    let tzStaffCookie: string[]; // Swhi-TZ-02 staff@投资
    let adminCookie: string[]; // Swhi-CGZX-admin
    /** C1 终审修复（2026-10-19）e2e 夹具：PENDING 新注册供应商（companyId=建设、无任何 link），afterAll 清理 */
    let c1UserId = '';
    let c1SupplierId = '';

    /** 注册 DTO：复用本文件既有注册用例的完整构造（含营业执照/主联系人/验证码双轨必填项），
     *  仅覆写 creditCode/companyId。信用代码查重分流（ACCOUNT_EXISTS_JOIN_INSTEAD）在手机验证之后、
     *  法人身份证/手机号盲索引查重之前，故此处值可独立不冲突。 */
    const existingRegisterBody = {
      companyId: '', // 每次请求覆写
      name: 'E2E多公司归属查重引导公司',
      creditCode: '', // 每次请求覆写为 dupCreditCode
      enterpriseType: '有限责任公司',
      legalPerson: '李四',
      legalPersonIdCard: '510104199001019999',
      registeredAddress: '测试地址',
      businessScope: '测试范围',
      username: 'ignored', // 注册强制 username=统一社会信用代码，此值被忽略
      displayName: '查重引导',
      password: 'Test1234',
      email: 'join-guide@test.com',
      registrationPhone: '13800000002',
      registrationCode: '123456', // SMS_DEBUG_BYPASS（setup-throttle.ts）下直过
      contacts: [{ name: '联系人', phone: '13800000002', idCard: '510104199001019998', isPrimary: true }],
      qualifications: [{ type: '营业执照', name: '企业法人营业执照', fileUrl: '/api/upload/files/e2e-join-guide-license' }],
      tags: ['物资供应', '工程服务'], // tags 需 ≥2 项（DTO @ArrayMinSize(2)）
    };

    beforeAll(async () => {
      const u = await prisma.user.findUnique({
        where: { username_role: { username: '重庆蜀通岩土工程有限公司', role: 'supplier' } },
      });
      const s = await prisma.supplier.findUnique({
        where: { userId: u!.id },
        select: { id: true, companyId: true, creditCode: true },
      });
      sup = s!;
      const byName = async (name: string): Promise<string> => {
        const c = await prisma.company.findUnique({ where: { name } });
        if (!c) throw new Error(`seed 缺少公司主数据：${name}`);
        return c.id;
      };
      bCompanyId = await byName('四川水发建设有限公司');
      cCompanyId = await byName('四川水发投资有限公司');
      dCompanyId = await byName('四川省水利发展集团有限公司');
      jsStaffCookie = await loginAs(app, 'Swhi-JS-02', 'Swhi-JS-02@2026', 'web');
      jsLeaderCookie = await loginAs(app, 'Swhi-JS-01', 'Swhi-JS-01@2026', 'web');
      tzStaffCookie = await loginAs(app, 'Swhi-TZ-02', 'Swhi-TZ-02@2026', 'web');
      adminCookie = await loginAs(app, 'Swhi-CGZX-admin', 'Swhi-CGZX-admin@2026', 'web');
    });

    afterAll(async () => {
      // 清理本 describe 建的 link（防污染后续 CI 跑：种子供应商的 link 恢复 backfill 态）
      if (sup) {
        await prisma.supplierCompanyLink.deleteMany({
          where: { supplierId: sup.id, companyId: { not: sup.companyId ?? '' } },
        });
      }
      // C1 终审修复 e2e 夹具：删 User 即级联删 Supplier（onDelete: Cascade）
      if (c1UserId) {
        await prisma.user.deleteMany({ where: { id: c1UserId } }).catch(() => {});
      }
    });

    it('申请 → 三级审批（staff→leader→admin）→ 终态 APPROVED', async () => {
      // 1. 供应商申请加入 B 公司
      const apply = await request(app.getHttpServer())
        .post('/api/supplier-portal/company-links/apply')
        .set('Cookie', supplierCookie)
        .set('X-Portal', 'supplier')
        .send({ companyName: bCompanyName, note: 'e2e 多公司归属' })
        .expect(201);
      expect(apply.body.id).toBeTruthy();

      // 2. 三级逐级通过（staff→leader→admin；staff/leader 须填同意缘由）
      const staffApprove = await request(app.getHttpServer())
        .post(`/api/supplier/company-links/${apply.body.id}/approve`)
        .set('Cookie', jsStaffCookie)
        .set('X-Portal', 'web')
        .send({ reason: 'e2e 初审通过' })
        .expect(201);
      expect(staffApprove.body.stage).toBe('LEADER');

      const leaderApprove = await request(app.getHttpServer())
        .post(`/api/supplier/company-links/${apply.body.id}/approve`)
        .set('Cookie', jsLeaderCookie)
        .set('X-Portal', 'web')
        .send({ reason: 'e2e 复审通过' })
        .expect(201);
      expect(leaderApprove.body.stage).toBe('ADMIN');

      const adminApprove = await request(app.getHttpServer())
        .post(`/api/supplier/company-links/${apply.body.id}/approve`)
        .set('Cookie', adminCookie)
        .set('X-Portal', 'web')
        .send({}) // 终审无须缘由
        .expect(201);
      expect(adminApprove.body.stage).toBe('DONE');

      // 3. 终态断言（硬闸）：供应商视角 B 公司库内状态 = APPROVED
      const mine = await request(app.getHttpServer())
        .get('/api/supplier-portal/company-links')
        .set('Cookie', supplierCookie)
        .set('X-Portal', 'supplier')
        .expect(200);
      const link = mine.body.find((l: any) => l.companyId === bCompanyId);
      expect(link).toBeTruthy();
      expect(link.status).toBe('APPROVED');
    });

    it('申请驳回：STAFF 级驳回 → REJECTED + 原因回传', async () => {
      const apply = await request(app.getHttpServer())
        .post('/api/supplier-portal/company-links/apply')
        .set('Cookie', supplierCookie)
        .set('X-Portal', 'supplier')
        .send({ companyName: cCompanyName })
        .expect(201);
      expect(apply.body.id).toBeTruthy();

      const rej = await request(app.getHttpServer())
        .post(`/api/supplier/company-links/${apply.body.id}/reject`)
        .set('Cookie', tzStaffCookie)
        .set('X-Portal', 'web')
        .send({ reason: 'e2e 驳回原因' })
        .expect(201);
      expect(rej.body.success).toBe(true);

      const mine = await request(app.getHttpServer())
        .get('/api/supplier-portal/company-links')
        .set('Cookie', supplierCookie)
        .set('X-Portal', 'supplier')
        .expect(200);
      const link = mine.body.find((l: any) => l.companyId === cCompanyId);
      expect(link).toBeTruthy();
      expect(link.status).toBe('REJECTED');
      expect(link.rejectReason).toBe('e2e 驳回原因');
    });

    it('注册查重引导：他司已入库信用代码注册其他公司 → ACCOUNT_EXISTS_JOIN_INSTEAD', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/supplier/register')
        .set('X-Portal', 'public')
        .send({ ...existingRegisterBody, creditCode: dupCreditCode, companyId: dCompanyId })
        .expect(400);
      expect(res.body.code).toBe('ACCOUNT_EXISTS_JOIN_INSTEAD');
    });

    // C1 终审修复（2026-10-19）：审批流面公司谓词双化——新注册件提交即落 Supplier.companyId，
    // 但 APPROVED link 要到 ADMIN 终审才 upsert，此前单 link 谓词致 B 公司 staff 的 PENDING 列表
    // 空（角标 myPendingReviewCount 按 companyId 计却有数——「角标有数、列表却空」）。
    it('新注册件（companyId=建设、无 link）→ 建设 staff 的 PENDING 列表可见（raw+ORM 双路径）、库视图不可见', async () => {
      const t = Date.now();
      const c1Name = `E2E-C1新注册供应商${t}`;
      const user = await prisma.user.create({
        data: { username: `e2e-c1-${t}`, role: 'supplier', displayName: 'C1双谓词', companyId: bCompanyId },
      });
      c1UserId = user.id;
      const supplier = await prisma.supplier.create({
        data: {
          userId: user.id, supplierNo: `E2E-C1-${t}`, name: c1Name, normalizedName: c1Name,
          creditCode: `9151C1${t}`, enterpriseType: '有限责任公司', legalPerson: '测试',
          registeredAddress: '测试地址', businessScope: '测试',
          companyId: bCompanyId, status: 'PENDING', reviewStage: 'STAFF',
        },
      });
      c1SupplierId = supplier.id;
      // 无任何 link（终审前事实）——双谓词的第二分支（主归属在视野）必须兜住
      expect(await prisma.supplierCompanyLink.count({ where: { supplierId: c1SupplierId } })).toBe(0);

      // raw 路径（默认 completeness 排序 = 审批面板实际路径）
      const raw = await request(app.getHttpServer())
        .get('/api/supplier/list')
        .query({ status: 'PENDING', search: 'E2E-C1新注册供应商' })
        .set('Cookie', jsStaffCookie)
        .set('X-Portal', 'web')
        .expect(200);
      expect(raw.body.items.some((i: any) => i.id === c1SupplierId)).toBe(true);

      // ORM 路径（sort=createdAt）
      const orm = await request(app.getHttpServer())
        .get('/api/supplier/list')
        .query({ status: 'PENDING', sort: 'createdAt', search: 'E2E-C1新注册供应商' })
        .set('Cookie', jsStaffCookie)
        .set('X-Portal', 'web')
        .expect(200);
      expect(orm.body.items.some((i: any) => i.id === c1SupplierId)).toBe(true);

      // 库视图（无 status）仍 APPROVED link-only——无 link 的新注册件不入库（Task 7 口径不动）
      const lib = await request(app.getHttpServer())
        .get('/api/supplier/list')
        .query({ search: 'E2E-C1新注册供应商' })
        .set('Cookie', jsStaffCookie)
        .set('X-Portal', 'web')
        .expect(200);
      expect(lib.body.items.some((i: any) => i.id === c1SupplierId)).toBe(false);
    });
  });
});
