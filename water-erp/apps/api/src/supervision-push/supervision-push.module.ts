// apps/api/src/supervision-push/supervision-push.module.ts
import { Module } from '@nestjs/common';
import { BidModule } from '../bid/bid.module';
import { SystemConfigModule } from '../system-config/system-config.module';
import { SignatureService } from '../common/crypto/signature.service';
import { SupervisionPushController } from './supervision-push.controller';
import { SupervisionPushService } from './supervision-push.service';
import { PlatformSigningService } from './platform-signing.service';

@Module({
  imports: [BidModule, SystemConfigModule], // Prisma/Storage 为全局模块
  controllers: [SupervisionPushController],
  providers: [SupervisionPushService, PlatformSigningService, SignatureService],
  exports: [SupervisionPushService],
})
export class SupervisionPushModule {}
