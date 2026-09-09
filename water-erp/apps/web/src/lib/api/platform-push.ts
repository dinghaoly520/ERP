import { api } from '../api';

/* ── 省平台数据对接专项 Phase 1（doc §四五端点）：上级平台推送适配层 ──
   后端 /platform-push/*（apps/api/src/platform-push）；仅类型化封装。
   人工确认制铁律：dispatch/export 必带 preview 返回的逐项 payloadHash（防预览后数据漂移）。 */

export type PushChannelCode = 'offline' | 'mock' | 'sc_province' | 'ceb_national' | 'mwr_water';

/** 383号文信息范围十类（doc §三映射表；plan 为 Phase 2 公告 metadata 扩展键预留） */
export type PushItemType =
  | 'plan' | 'bid_notice' | 'clarify' | 'failed_bid' | 'pre_win' | 'win'
  | 'contract' | 'fulfillment' | 'penalty' | 'prequal';

export interface PlatformPushChannelView {
  code: PushChannelCode;
  title: string;
  connected: boolean;
}

export interface PendingItem {
  itemId: string;
  itemType: PushItemType;
  title: string;
  /** 映射完整度（false = 缺字段禁推，missing 列缺口名） */
  ready: boolean;
  missing: string[];
  lastPush: {
    channel: string;
    status: string;
    createdAt: string;
    responseSnippet: string | null;
  } | null;
}

export interface PendingResponse {
  project: { id: string; projectCode: string; name: string; gbProcureCode: string | null };
  channels: PlatformPushChannelView[];
  items: PendingItem[];
}

/** 脱敏选项（doc §七-3：限价/合同金额——预览与推送同源同规则，hash 含脱敏效果） */
export interface PushMaskOptions {
  ceilingPrice?: boolean;
  contractAmount?: boolean;
}

/** 中间信封（schema='sc-v2-preview'：预览与推送同一份确定性产物，hash 锚定它） */
export interface PlatformPushEnvelope {
  itemType: PushItemType;
  schema: 'sc-v2-preview';
  projectCode: string | null;
  gbProcureCode: string | null;
  title: string;
  publishedAt: string | null;
  fields: Record<string, unknown>;
  masked: string[];
}

export interface PreviewItem {
  itemId: string;
  itemType: PushItemType;
  envelope: PlatformPushEnvelope;
  /** sha256(canonicalJson(envelope))——dispatch/export 原样回传校验 */
  payloadHash: string;
}

export interface PreviewResponse {
  schema: 'sc-v2-preview';
  mask: PushMaskOptions;
  items: PreviewItem[];
}

export type PlatformPushStatus = 'SUCCESS' | 'FAILED' | 'EXPORTED' | 'STUB_REFUSED';

export interface PushLogRow {
  id: string;
  channel: string;
  itemType: PushItemType;
  itemId: string;
  projectId: string | null;
  projectCode: string | null;
  status: PlatformPushStatus | string;
  payloadSha256: string | null;
  responseSnippet: string | null;
  errorMessage: string | null;
  /** 离线导出专属：文件包 FileAsset id（category=platform_push_package） */
  packetAssetId: string | null;
  attemptNo: number;
  masked: string[] | null;
  createdAt: string;
}

export interface DispatchResponse {
  channel: PushChannelCode;
  results: PushLogRow[];
}

export interface ExportResultItem {
  itemId: string;
  status: string;
  packetAssetId: string | null;
  downloadUrl: string | null;
  log: PushLogRow;
}

export interface ExportResponse {
  channel: 'offline';
  results: ExportResultItem[];
}

export interface PushStatusResponse {
  projectId: string | null;
  summary: Record<string, number>;
  logs: PushLogRow[];
}

export interface ItemHashPair {
  itemId: string;
  payloadHash: string;
}

export const platformPushApi = {
  /** 待推清单（按项目聚合公告/合同 + 全局处罚行，含完整度与历史推送态） */
  pending: (projectId: string) =>
    api.get<PendingResponse>(`/platform-push/pending?projectId=${encodeURIComponent(projectId)}`),
  /** 预览（中间信封+逐项指纹；脱敏即生效——变更须重新预览） */
  preview: (itemIds: string[], mask?: PushMaskOptions) =>
    api.post<PreviewResponse>('/platform-push/preview', { itemIds, mask }),
  /** 确认推送（stub 通道 501 CHANNEL_NOT_CONNECTED 引导离线导出；mock 演示全链） */
  dispatch: (channel: PushChannelCode, itemIds: string[], payloadHashes: ItemHashPair[], mask?: PushMaskOptions) =>
    api.post<DispatchResponse>('/platform-push/dispatch', { channel, itemIds, payloadHashes, mask }),
  /** 离线导出（现役主出口：按数据项粒度出 JSON 文件包+SHA-256） */
  exportItems: (itemIds: string[], payloadHashes: ItemHashPair[], mask?: PushMaskOptions) =>
    api.post<ExportResponse>('/platform-push/export', { itemIds, payloadHashes, mask }),
  /** 推送台账（projectId 过滤；缺省全量含全局处罚行） */
  status: (projectId?: string) =>
    api.get<PushStatusResponse>(projectId ? `/platform-push/status?projectId=${encodeURIComponent(projectId)}` : '/platform-push/status'),
};
