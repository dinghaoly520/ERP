// apps/api/src/platform-push/platform-push.module.ts
// 对接专项 Phase 1：PushChannel 五通道注册 + 人工确认制五端点。
// PrismaModule/StorageModule 均为 @Global（同 supervision-push 模式），无需显式 import。
import { Module } from '@nestjs/common';
import { PlatformPushController } from './platform-push.controller';
import { PlatformPushService } from './platform-push.service';
import { ScProvinceChannel } from './channels/sc-province.channel';
import { CebNationalChannel } from './channels/ceb-national.channel';
import { MwrWaterChannel } from './channels/mwr-water.channel';
import { MockChannel } from './channels/mock.channel';
import { OfflineExportChannel } from './channels/offline.export-channel';

@Module({
  controllers: [PlatformPushController],
  providers: [PlatformPushService, ScProvinceChannel, CebNationalChannel, MwrWaterChannel, MockChannel, OfflineExportChannel],
  exports: [PlatformPushService],
})
export class PlatformPushModule {}
