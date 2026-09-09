// apps/api/src/platform-push/channels/stub.channel.ts
// stub 通道基类（doc §四 Phase 2 预留）：connected=false，dispatch 抛 ChannelNotConnectedError
// → controller 501 CHANNEL_NOT_CONNECTED 引导离线导出（service 先落 STUB_REFUSED 日志行再抛）。
import {
  ChannelNotConnectedError, PushChannel, PushChannelDispatchContext, PushChannelDispatchResult,
} from '../push-channel.interface';
import { PushChannelCode } from '../platform-push-payload';

export abstract class StubChannel implements PushChannel {
  abstract readonly code: PushChannelCode;
  abstract readonly title: string;
  readonly connected = false;

  dispatch(_ctx: PushChannelDispatchContext): Promise<PushChannelDispatchResult> {
    return Promise.reject(new ChannelNotConnectedError(
      this.code,
      `${this.title}未连通（省平台接口规约未发布，Phase 2 联调）；当前请使用离线导出报送`,
    ));
  }
}
