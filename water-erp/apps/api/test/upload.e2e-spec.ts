import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

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

/** 将二进制响应体读取为 Buffer */
function binaryParser(res: any, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

describe('Upload (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminCookie: string[];
  const fileBuffer = Buffer.from('%PDF-1.4 e2e upload sample content');
  let uploadedId: string;

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
    adminCookie = await loginAs(app, '陈主任', 'czr@2026', 'web');
  });

  afterAll(async () => {
    if (uploadedId) {
      await prisma.fileAsset.deleteMany({ where: { id: uploadedId } }).catch(() => {});
    }
    await app.close();
  });

  it('上传合法 PDF → 201，返回完整字段', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/upload?category=qualification')
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .attach('file', fileBuffer, { filename: 'sample.pdf', contentType: 'application/pdf' })
      .expect(201);

    for (const key of ['id', 'key', 'url', 'originalName', 'mimeType', 'size', 'category', 'sha256', 'createdAt']) {
      expect(res.body).toHaveProperty(key);
    }
    expect(res.body.mimeType).toBe('application/pdf');
    expect(res.body.size).toBe(fileBuffer.length);
    expect(res.body.url).toMatch(/^\/api\/upload\/files\//);
    uploadedId = res.body.id;
  });

  it('文件元数据已写入数据库', async () => {
    const asset = await prisma.fileAsset.findUnique({ where: { id: uploadedId } });
    expect(asset).not.toBeNull();
    expect(asset!.originalName).toBe('sample.pdf');
    expect(asset!.sha256).toBeTruthy();
  });

  it('鉴权下载返回原始字节', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/upload/files/${uploadedId}`)
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .buffer(true)
      .parse(binaryParser)
      .expect(200);

    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).equals(fileBuffer)).toBe(true);
  });

  it('未登录下载应返回 401', async () => {
    await request(app.getHttpServer())
      .get(`/api/upload/files/${uploadedId}`)
      .expect(401);
  });

  it('非法 MIME 类型应被拒绝（400）', async () => {
    await request(app.getHttpServer())
      .post('/api/upload?category=qualification')
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .attach('file', Buffer.from('fake exe'), { filename: 'bad.exe', contentType: 'application/x-msdownload' })
      .expect(400);
  });

  it('非法分类应被拒绝（400）', async () => {
    await request(app.getHttpServer())
      .post('/api/upload?category=malware')
      .set('Cookie', adminCookie)
      .set('X-Portal', 'web')
      .attach('file', fileBuffer, { filename: 'sample.pdf', contentType: 'application/pdf' })
      .expect(400);
  });

  it('超过 50MB 的文件应被拒绝', async () => {
    const big = Buffer.alloc(51 * 1024 * 1024, 0x61); // 51MB
    let rejected = false;
    try {
      const res = await request(app.getHttpServer())
        .post('/api/upload?category=general')
        .set('Cookie', adminCookie)
        .set('X-Portal', 'web')
        .ok(() => true)
        .attach('file', big, { filename: 'big.txt', contentType: 'text/plain' });
      rejected = res.status >= 400;
    } catch {
      // Multer 达到大小上限可能中断连接，视为已拒绝
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
});
