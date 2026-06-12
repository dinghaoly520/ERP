import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

const CLIENT_PORTS = { web: 3002, supplier: 3003, expert: 3004, public: 3005 };

function corsOrigins(): string[] {
  const origins: string[] = [];
  for (const port of Object.values(CLIENT_PORTS)) {
    origins.push(`http://localhost:${port}`, `http://127.0.0.1:${port}`);
  }
  return origins;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

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
