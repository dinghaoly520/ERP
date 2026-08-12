import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { PORTS } from '@water-erp/config';

// 全局未捕获异常/拒绝 —— 记录崩溃原因，避免静默退出
const crashLogger = new Logger('ProcessCrash');
process.on('uncaughtException', (err) => {
  crashLogger.error(`未捕获异常: ${err.message}`, err.stack);
  // 不 process.exit — 让 NestJS 自行处理
});
process.on('unhandledRejection', (reason) => {
  crashLogger.error(`未处理的 Promise 拒绝: ${reason}`, (reason as Error)?.stack);
});

function corsOrigins(): string[] {
  // 生产通过 CORS_ORIGINS 逗号分隔配置真实域名；未设置时回退到本地门户端口
  const envOrigins = process.env.CORS_ORIGINS;
  if (envOrigins) {
    return envOrigins.split(',').map((o) => o.trim()).filter(Boolean);
  }
  const origins: string[] = [];
  for (const port of Object.values(PORTS)) {
    origins.push(`http://localhost:${port}`, `http://127.0.0.1:${port}`);
  }
  return origins;
}

async function bootstrap() {
  // 关闭 NestJS 内置 bodyParser（默认 json 上限仅 100kb），改用显式上限，
  // 否则 OCR 证件识别等 base64 图片请求（>75KB 原图即超限）会在进入 handler 前被 413 拒绝。
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const logger = new Logger('Bootstrap');
  const bodyLimit = process.env.HTTP_BODY_LIMIT || '10mb';
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));

  // 信任代理头（X-Forwarded-For 等），使 req.ip 返回真实客户端 IP。
  // 反代后须设 TRUST_PROXY=1（信任一跳），否则 req.ip 显示为代理 IP，限流/审计失真。
  const trustProxy = process.env.TRUST_PROXY || 'loopback';
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);
  logger.log(`Trust proxy: ${trustProxy}`);

  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // 安全响应头：HSTS（需 HTTPS 生效）、X-Frame-Options（防点击劫持）、
  // X-Content-Type-Options（防 MIME 嗅探）、CSP（XSS 纵深）。
  // CSP 起步宽松（unsafe-inline），生产隐藏 Swagger 后再迭代收紧。
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"], // Swagger UI 内联；生产隐藏 Swagger 后可收紧
          styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind v4 内联样式
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'], // MinIO / data URI
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'https:', 'wss:', 'ws:'], // WebSocket + API
          mediaSrc: ["'self'", 'blob:', 'https:'], // 视频背景
          frameSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: [], // HSTS 配套
        },
      },
      crossOriginEmbedderPolicy: false, // 避免破坏跨域资源嵌入
    }),
  );

  // 开发/测试环境允许任意跨域来源（局域网设备访问）；
  // 生产环境仅允许 CORS_ORIGINS 或 fallback localhost 列表。
  const isProduction = process.env.NODE_ENV === 'production';
  const corsOrigin = isProduction
    ? corsOrigins()
    : (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
        // 允许 localhost、127.0.0.1、局域网 IP（192.168./10./172.16-31.）及任意 origin
        cb(null, true);
      };
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });
  if (isProduction) {
    logger.log(`CORS origins: ${corsOrigins().join(', ')}`);
  } else {
    logger.log('CORS: all origins allowed (non-production mode)');
  }

  // Swagger API 文档 —— 仅非生产环境挂载，生产隐藏避免接口面泄露
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('智慧水发·招采ERP系统')
      .setDescription('四川水发集团电子化招标采购平台 API 文档')
      .setVersion('1.0')
      .addCookieAuth('token')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT || 4001;
  await app.listen(port);
  logger.log(`API running on http://localhost:${port}`);
  if (process.env.NODE_ENV !== 'production') {
    logger.log(`Swagger docs at http://localhost:${port}/api/docs`);
  }
}
bootstrap();
