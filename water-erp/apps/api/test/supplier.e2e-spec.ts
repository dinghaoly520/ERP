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
    const u = await prisma.user.findUnique({ where: { username_role: { username: 'supplier1', role: 'supplier' } } });
    const s = u ? await prisma.supplier.findUnique({ where: { userId: u.id } }) : null;
    dupCreditCode = s?.creditCode || 'DUPLICATE00000000';

    supplierCookie = await loginAs(app, 'supplier1', 'supplier1@2026', 'supplier');
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: orphanUsername } }).catch(() => {});
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
      .send({
        name: 'E2E重复信用代码公司',
        creditCode: dupCreditCode,
        enterpriseType: '有限责任公司',
        legalPerson: '张三',
        registeredAddress: '测试地址',
        businessScope: '测试范围',
        username: orphanUsername,
        displayName: '孤儿测试',
        password: '123456',
        email: 'orph@test.com',
        contacts: [{ name: '联系人', phone: '13800000000', isPrimary: true }],
        qualifications: [],
      })
      .expect(400);
    // 应是信用代码重复导致的业务错误
    expect(res.body.code).toBe('DUPLICATE_CREDIT_CODE');

    // 关键：失败后 user 表不应留下孤立记录
    const orphan = await prisma.user.findUnique({ where: { username_role: { username: orphanUsername, role: 'supplier' } } });
    expect(orphan).toBeNull();
  });
});
