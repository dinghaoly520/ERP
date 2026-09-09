// apps/api/src/platform-push/channels/mwr-water.channel.ts
// 全国水利建设市场监管服务平台通道（水利行业信用/处罚）：预留 stub（后续立项）。
import { Injectable } from '@nestjs/common';
import { PushChannelCode } from '../platform-push-payload';
import { StubChannel } from './stub.channel';

@Injectable()
export class MwrWaterChannel extends StubChannel {
  readonly code: PushChannelCode = 'mwr_water';
  readonly title = '全国水利建设市场监管平台';
}
