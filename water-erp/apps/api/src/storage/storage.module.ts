import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * StorageModule — MinIO 封装（移植自 procurement，去掉 StorageCleanupService）
 * @Global 使 ai-bid-analysis 等模块可直接注入 StorageService
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
