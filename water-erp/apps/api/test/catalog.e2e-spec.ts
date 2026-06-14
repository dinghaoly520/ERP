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

const PRICE_KEYS = ['referencePrice', 'priceMin', 'priceMax', 'lastDealPrice', 'averagePrice', 'changeRate', 'priceSource'];

describe('Catalog supply application (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let supplierCookie: string[];
  let adminCookie: string[];
  let supplierId: string;

  // 运行时选取的干净品类 + 测试中创建的记录（用于清理）
  let cleanItemId: string;
  let steelItemId: string;
  const createdAppIds: string[] = [];
  const createdCatalogItemIds: string[] = [];

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

    const supplierUser = await prisma.user.findUnique({ where: { username: 'supplier1' } });
    const supplier = supplierUser ? await prisma.supplier.findUnique({ where: { userId: supplierUser.id } }) : null;
    supplierId = supplier!.id;

    // 找一个 supplier1 既无准入关系、也无进行中申请的目录条目（用于 JOIN_EXISTING 全流程）
    const items = await prisma.catalogItem.findMany({ orderBy: { code: 'asc' } });
    for (const it of items) {
      const [active, inProgress] = await Promise.all([
        prisma.catalogSupplier.findUnique({ where: { catalogItemId_supplierId: { catalogItemId: it.id, supplierId: supplierId } } }),
        prisma.supplierCatalogApplication.findFirst({
          where: { supplierId, catalogItemId: it.id, status: { in: ['PENDING', 'COUNTERED', 'RETURNED'] } },
        }),
      ]);
      if (!active && !inProgress) { cleanItemId = it.id; break; }
    }
    expect(cleanItemId).toBeDefined();

    // 钢材（STEEL-001）：seed 中 supplier1 已有 ACTIVE 准入关系，用于 UPDATE_QUOTE
    const steel = await prisma.catalogItem.findUnique({ where: { code: 'CGML-GC-STEEL-001' } });
    steelItemId = steel!.id;

    supplierCookie = await loginAs(app, 'supplier1', 'supplier1@2026', 'supplier');
    adminCookie = await loginAs(app, 'caigou', 'caigou@2026', 'web');
  });

  afterAll(async () => {
    // 清理测试创建的数据，避免污染后续 seed / 测试
    await prisma.catalogSupplier.deleteMany({ where: { sourceApplicationId: { in: createdAppIds } } }).catch(() => {});
    await prisma.supplierCatalogApplication.deleteMany({ where: { id: { in: createdAppIds } } }).catch(() => {});
    await prisma.catalogItem.deleteMany({ where: { id: { in: createdCatalogItemIds } } }).catch(() => {});
    await app.close();
  });

  it('脱敏浏览：供应商目录接口绝不返回价格字段', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/supplier-portal/catalog/items')
      .set('Cookie', supplierCookie)
      .set('X-Portal', 'supplier')
      .expect(200);
    const items = res.body as any[];
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      for (const key of PRICE_KEYS) {
        expect(it).not.toHaveProperty(key);
      }
      // 供应商端只见数量，不见名称
      expect(it).toHaveProperty('supplierCount');
      expect(it).not.toHaveProperty('supplier');
    }
  });

  it('JOIN_EXISTING 全流程：提交 → 防重复 → 议价 → 接受 → 通过 → 建立关系', async () => {
    // 1. 提交
    const createRes = await request(app.getHttpServer())
      .post('/api/supplier-portal/catalog-applications')
      .set('Cookie', supplierCookie)
      .set('X-Portal', 'supplier')
      .send({ type: 'JOIN_EXISTING', catalogItemId: cleanItemId, quotedPrice: 100, region: '成都', qualificationNote: 'e2e 测试' })
      .expect(201);
    const appId = createRes.body.id;
    createdAppIds.push(appId);
    expect(createRes.body.status).toBe('PENDING');

    // 2. 防重复
    await request(app.getHttpServer())
      .post('/api/supplier-portal/catalog-applications')
      .set('Cookie', supplierCookie)
      .set('X-Portal', 'supplier')
      .send({ type: 'JOIN_EXISTING', catalogItemId: cleanItemId, quotedPrice: 101 })
      .expect(400);

    // 3. 管理员议价
    await request(app.getHttpServer())
      .post(`/api/catalog/applications/${appId}/review`)
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .send({ action: 'counter', counterPrice: 95, counterNote: 'e2e 议价' })
      .expect(201);

    // 4. 供应商接受议价
    const acceptRes = await request(app.getHttpServer())
      .post(`/api/supplier-portal/catalog-applications/${appId}/accept-counter`)
      .set('Cookie', supplierCookie)
      .set('X-Portal', 'supplier')
      .expect(201);
    expect(acceptRes.body.status).toBe('PENDING');
    expect(Number(acceptRes.body.quotedPrice)).toBe(95);

    // 5. 管理员通过
    const approveRes = await request(app.getHttpServer())
      .post(`/api/catalog/applications/${appId}/review`)
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .send({ action: 'approve' })
      .expect(201);
    expect(approveRes.body.status).toBe('APPROVED');

    // 6. 准入关系已建立
    const suppliersRes = await request(app.getHttpServer())
      .get(`/api/catalog/items/${cleanItemId}/suppliers`)
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .expect(200);
    const matched = (suppliersRes.body as any[]).find(s => s.supplierId === supplierId);
    expect(matched).toBeDefined();
    expect(matched.status).toBe('ACTIVE');
    expect(Number(matched.quotedPrice)).toBe(95);
  });

  it('UPDATE_QUOTE：改报价申请 → 通过 → 价格更新', async () => {
    const before = await prisma.catalogSupplier.findUnique({
      where: { catalogItemId_supplierId: { catalogItemId: steelItemId, supplierId } },
    });
    const oldPrice = Number(before!.quotedPrice);

    const createRes = await request(app.getHttpServer())
      .post('/api/supplier-portal/catalog-applications')
      .set('Cookie', supplierCookie)
      .set('X-Portal', 'supplier')
      .send({ type: 'UPDATE_QUOTE', catalogItemId: steelItemId, quotedPrice: oldPrice + 50, qualificationNote: 'e2e 改价' })
      .expect(201);
    const appId = createRes.body.id;
    createdAppIds.push(appId);
    expect(createRes.body.status).toBe('PENDING');

    // 无 ACTIVE 关系时不能 UPDATE_QUOTE（用 cleanItemId 验证，此时 cleanItemId 已有 active —— 改用尚未准入的思路跳过此处细节）
    // 通过审核
    await request(app.getHttpServer())
      .post(`/api/catalog/applications/${appId}/review`)
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .send({ action: 'approve' })
      .expect(201);

    const after = await prisma.catalogSupplier.findUnique({
      where: { catalogItemId_supplierId: { catalogItemId: steelItemId, supplierId } },
    });
    expect(Number(after!.quotedPrice)).toBe(oldPrice + 50);
  });

  it('NEW_ITEM：通过时必须填写参考价，否则 400；填写后新建目录条目 + 准入关系', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/supplier-portal/catalog-applications')
      .set('Cookie', supplierCookie)
      .set('X-Portal', 'supplier')
      .send({
        type: 'NEW_ITEM',
        proposedName: 'E2E 测试物资',
        proposedSpec: 'e2e-spec',
        proposedCategory: '管材', proposedGroup: '工程材料', proposedUnit: '米',
        quotedPrice: 200, qualificationNote: 'e2e 新增',
      })
      .expect(201);
    const appId = createRes.body.id;
    createdAppIds.push(appId);

    // 缺参考价 → 400
    await request(app.getHttpServer())
      .post(`/api/catalog/applications/${appId}/review`)
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .send({ action: 'approve' })
      .expect(400);

    // 带参考价 → 通过
    const approveRes = await request(app.getHttpServer())
      .post(`/api/catalog/applications/${appId}/review`)
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .send({ action: 'approve', referencePrice: 195, priceMin: 180, priceMax: 210 })
      .expect(201);
    expect(approveRes.body.status).toBe('APPROVED');
    expect(approveRes.body.catalogItemId).not.toBeNull();
    expect(Number(approveRes.body.approvedReferencePrice)).toBe(195);

    // 验证新建了 CatalogItem
    const newItem = await prisma.catalogItem.findUnique({ where: { id: approveRes.body.catalogItemId } });
    expect(newItem).not.toBeNull();
    expect(newItem!.name).toBe('E2E 测试物资');
    expect(Number(newItem!.referencePrice)).toBe(195);
    createdCatalogItemIds.push(newItem!.id);

    // 验证建立了准入关系
    const link = await prisma.catalogSupplier.findUnique({
      where: { catalogItemId_supplierId: { catalogItemId: newItem!.id, supplierId } },
    });
    expect(link).not.toBeNull();
    expect(Number(link!.quotedPrice)).toBe(200);
  });

  it('供应商可在「我的供货关系」看到已准入品类', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/supplier-portal/catalog-supply')
      .set('Cookie', supplierCookie)
      .set('X-Portal', 'supplier')
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect((res.body as any[]).length).toBeGreaterThan(0);
  });
});
