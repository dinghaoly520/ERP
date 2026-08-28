import { api } from '../api';

/* ── A-153：监督推送适配层（spec §4.8）──
   后端 /supervision-push/*（apps/api/src/supervision-push）；仅类型化封装。
   推送不作为归档闸门（外部平台未接入不得卡归档）。 */

export interface SupervisionPushConfigView {
  enabled: boolean;
  endpoint: string;
  authToken: string; // 掩码 '******' 或 ''
  timeoutMs: number;
  platformCode: string;
}

export interface SupervisionPushLogItem {
  id: string;
  projectId: string;
  payloadType: string;
  status: 'SUCCESS' | 'FAILED' | 'VOUCHER_EXPORTED';
  endpoint: string | null;
  responseCode: number | null;
  responseSnippet: string | null;
  errorMessage: string | null;
  attemptNo: number;
  requestSha256: string | null;
  signedBy: string | null;
  voucherAssetId: string | null;
  createdAt: string;
}

export interface SupervisionPushStatus {
  config: SupervisionPushConfigView;
  gate: { ready: boolean; reason: string | null };
  latest: SupervisionPushLogItem | null;
}

/** POST config 为全量替换：五字段须一并提交；authToken ''/'******' = 保持现有 */
export function saveSupervisionConfig(cfg: Partial<SupervisionPushConfigView>) {
  return api.post<SupervisionPushConfigView>('/supervision-push/config', cfg);
}

export const supervisionApi = {
  getStatus: (projectId: string) =>
    api.get<SupervisionPushStatus>(`/supervision-push/projects/${projectId}/status`),
  /** 201 ≠ 推送成功——读返回 log.status/errorMessage/responseCode */
  pushNow: (projectId: string, payloadType = 'EVALUATION_REPORT') =>
    api.post<SupervisionPushLogItem>(`/supervision-push/projects/${projectId}/push`, { payloadType }),
  exportVoucher: (projectId: string, payloadType = 'EVALUATION_REPORT') =>
    api.post<{ voucherAssetId: string; downloadUrl: string; log: SupervisionPushLogItem }>(
      `/supervision-push/projects/${projectId}/voucher`,
      { payloadType },
    ),
  listLogs: (projectId: string) =>
    api.get<SupervisionPushLogItem[]>(`/supervision-push/projects/${projectId}/logs`),
  getConfig: () => api.get<SupervisionPushConfigView>('/supervision-push/config'),
  saveConfig: saveSupervisionConfig,
};
