import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BidBackupService } from './bid-backup.service';

/**
 * 未解密投标文件备份模块。被 SupplierPortalModule（写入钩子）与 BidModule（核验端点）共同导入；
 * Nest 去重为单例，@Cron 补备任务仅注册一次。ScheduleModule.forRoot() 已由 SchedulerModule 全局注册。
 */
@Module({
  imports: [PrismaModule],
  providers: [BidBackupService],
  exports: [BidBackupService],
})
export class BidBackupModule {}
