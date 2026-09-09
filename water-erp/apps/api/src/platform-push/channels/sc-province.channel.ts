// apps/api/src/platform-push/channels/sc-province.channel.ts
// 省平台通道（ggzyjy.sc.gov.cn，主目标）：Phase 2 实装（V2.0 字段级映射+签名头）；Phase 1 stub。
import { Injectable } from '@nestjs/common';
import { PushChannelCode } from '../platform-push-payload';
import { StubChannel } from './stub.channel';

@Injectable()
export class ScProvinceChannel extends StubChannel {
  readonly code: PushChannelCode = 'sc_province';
  readonly title = '四川省公共资源交易平台';
}
