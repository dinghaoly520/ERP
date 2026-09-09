// apps/api/src/platform-push/channels/mock.channel.ts
// mock 演示通道（doc §六 Phase 1「mock 通道可演示推送留痕」）：connected=true 真走全链，
// 回执前缀 MOCK- 明示非真实推送——UI/e2e 验证人工确认制全链（预览→hash→确认→台账）用。
import { Injectable } from '@nestjs/common';
import { PushChannelCode } from '../platform-push-payload';
import {
  PushChannel, PushChannelDispatchContext, PushChannelDispatchResult,
} from '../push-channel.interface';

@Injectable()
export class MockChannel implements PushChannel {
  readonly code: PushChannelCode = 'mock';
  readonly title = '演示通道(mock)';
  readonly connected = true;

  dispatch(_ctx: PushChannelDispatchContext): Promise<PushChannelDispatchResult> {
    return Promise.resolve({ ok: true, responseSnippet: `MOCK-${Date.now()}` });
  }
}
