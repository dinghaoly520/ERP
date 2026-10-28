import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsInterceptor } from './metrics.interceptor';

/** 'REDIS_CLIENT' 由 @Global RedisModule（app.module 已引）提供，此处无需重复 import */
@Global()
@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: MetricsInterceptor }],
})
export class MetricsModule {}
