// apps/api/src/platform-push/push-channel.interface.ts
// PushChannel provider 抽象（doc §四）：五通道可插拔。序列化不在通道内——service 统一产出
// 中间信封（五通道共享；省规约发布后仅 sc_province 在信封外补加密/签名层）。
import { PlatformPushEnvelope, PushChannelCode, PushItemType } from './platform-push-payload';

/** 通道未连通（stub 期三通道）：controller 捕获后 501 CHANNEL_NOT_CONNECTED 引导离线导出 */
export class ChannelNotConnectedError extends Error {
  constructor(readonly channelCode: PushChannelCode, message: string) {
    super(message);
    this.name = 'ChannelNotConnectedError';
  }
}

export interface PushChannelDispatchContext {
  itemId: string;
  itemType: PushItemType;
  title: string;
  projectId: string | null;
  projectCode: string | null;
  envelope: PlatformPushEnvelope;
  actorId: string;
}

export interface PushChannelDispatchResult {
  ok: boolean;
  /** 回执摘要（≤2KB，入 PlatformPushLog.responseSnippet） */
  responseSnippet?: string;
  errorMessage?: string;
  /** 离线导出专属：FileAsset id（category=platform_push_package） */
  packetAssetId?: string;
}

export interface PushChannel {
  readonly code: PushChannelCode;
  /** UI 展示名（mock 通道明示「演示」，防误当真实推送） */
  readonly title: string;
  readonly connected: boolean;
  dispatch(ctx: PushChannelDispatchContext): Promise<PushChannelDispatchResult>;
}
