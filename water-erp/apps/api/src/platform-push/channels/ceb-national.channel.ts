// apps/api/src/platform-push/channels/ceb-national.channel.ts
// 国家公共服务平台通道（connect.cebpubservice.com，注册登记+公告公示交换）：预留 stub。
import { Injectable } from '@nestjs/common';
import { PushChannelCode } from '../platform-push-payload';
import { StubChannel } from './stub.channel';

@Injectable()
export class CebNationalChannel extends StubChannel {
  readonly code: PushChannelCode = 'ceb_national';
  readonly title = '中国招标投标公共服务平台';
}
