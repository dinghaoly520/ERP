import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';

/**
 * bug#163（2026-11-17）契约锁：engine.io 默认 addTrailingSlash=true 时服务端只认
 * `/socket.io/`（带尾斜杠，engine.io@6.6.8 build/server.js `_computePath`+checkRequest
 * 前缀精确比对），而旧版 socket.io-client（<4.6，生产存量 bundle 依赖漂移）握手请求
 * `/socket.io?...`（无尾斜杠）被 404——生产「重连中/在线0」双层根因之一。
 * 三网关（bid/notifications/chat）已改 `addTrailingSlash: false`：路径按 `/socket.io`
 * 前缀比对，新旧客户端两种形式通吃。本组探针锁死该契约，防依赖升级回退。
 */
describe('socket.io 握手路径双形式 (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const expectHandshake = (res: request.Response) => {
    expect(res.status).toBe(200);
    // engine.io OPEN 包：'0' + handshake JSON（sid/upgrades/pingInterval...）
    expect(res.text).toMatch(/^0\{"sid"/);
  };

  it('无尾斜杠 /socket.io?EIO=4… 握手成功（旧版 socket.io-client 形态，bug#163）', async () => {
    const res = await request(app.getHttpServer()).get('/socket.io?EIO=4&transport=polling&t=e2e-noslash');
    expectHandshake(res);
  });

  it('带尾斜杠 /socket.io/?EIO=4… 握手成功（新版 socket.io-client 形态）', async () => {
    const res = await request(app.getHttpServer()).get('/socket.io/?EIO=4&transport=polling&t=e2e-slash');
    expectHandshake(res);
  });
});
