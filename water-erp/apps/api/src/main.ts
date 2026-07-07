import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
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
  const origins: string[] = [];
  for (const port of Object.values(PORTS)) {
    origins.push(`http://localhost:${port}`, `http://127.0.0.1:${port}`);
  }
  return origins;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // 信任代理头（X-Forwarded-For 等），使 req.ip 返回真实客户端 IP
  // Express 默认出于安全考虑忽略代理头，本地开发时 trust 'loopback' 即可
  // 生产环境部署在 nginx 反代后时 trust 第一个代理的 IP
  app.getHttpAdapter().getInstance().set('trust proxy', true);

  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableCors({
    origin: corsOrigins(),
    credentials: true,
  });

  // Swagger API 文档
  const config = new DocumentBuilder()
    .setTitle('智慧水发·招采ERP系统')
    .setDescription('四川水发集团电子化招标采购平台 API 文档')
    .setVersion('1.0')
    .addCookieAuth('token')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 4001;
  await app.listen(port);
  logger.log(`API running on http://localhost:${port}`);
  logger.log(`Swagger docs at http://localhost:${port}/api/docs`);
}
bootstrap();
