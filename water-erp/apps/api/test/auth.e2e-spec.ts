import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/api/auth/me (GET) — 未认证应返回 401', () => {
    return request(app.getHttpServer())
      .get('/api/auth/me')
      .expect(401);
  });

  it('/api/announcements/public (GET) — 公开接口无需认证', () => {
    return request(app.getHttpServer())
      .get('/api/announcements/public')
      .expect(200)
      .expect(res => {
        expect(res.body).toHaveProperty('items');
        expect(res.body).toHaveProperty('total');
        expect(Array.isArray(res.body.items)).toBe(true);
      });
  });

  it('/api/auth/login (POST) — 无效凭证应返回错误', () => {
    return request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'nonexistent', password: 'wrong' })
      .expect(401);
  });
});
