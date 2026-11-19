/**
 * 项目管理归档/终止详情（2026-11-19：台账详情对齐 :3005 archive-detail-modal 同源）。
 *  GET /project-management/archive/:roundId——归档走归档 TXT 链路，终止走
 *  terminationSnapshot 实时同构载荷；无 PMI 关联（Excel 导入轮次）404 由调用方回退简版。
 */
import { api } from "../api";

export type ArchiveAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  filePath: string | null;
  analysis: string;
};

export type ArchiveStage = {
  stageKey: string;
  stageName: string;
  stageDirName: string;
  /** 所属轮次（旧载荷缺省视作 1） */
  round?: number | null;
  status: string;
  attachments: ArchiveAttachment[];
};

export type ArchiveDetail = {
  projectId: string;
  projectTitle: string;
  archivedAt: string | null;
  /** terminated = 终止详情（复用同构载荷） */
  kind?: "archived" | "terminated";
  archivedRound?: number | null;
  terminatedRound?: number | null;
  basicInfo: Record<string, string>;
  extractedInfo: Record<string, string>;
  summary: string;
  stages: ArchiveStage[];
};

export async function fetchArchiveDetail(procurementRoundId: string): Promise<ArchiveDetail> {
  return api.get<ArchiveDetail>(`/project-management/archive/${procurementRoundId}`);
}

/** 步骤分析（LLM 懒生成，服务端缓存命中秒回）——与 :3005 analyze-step 同契约 */
export async function fetchStepAnalysis(
  projectId: string,
  stageKey: string,
  round?: number,
): Promise<{ content: string; empty: boolean }> {
  const params = new URLSearchParams({ stageKey });
  if (round != null) params.set("round", String(round));
  return api.post<{ content: string; empty: boolean }>(`/project-management/${projectId}/analyze-step?${params.toString()}`, {});
}
