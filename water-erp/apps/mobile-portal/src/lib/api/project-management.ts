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
  /** 终止详情专属：步骤分析缓存直出（2026-11-19「缓存直出+按需生成」裁定） */
  stageAnalysis?: string;
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

/** 步骤分析懒生成（analyze-step，服务端指纹缓存命中秒回）——终止详情「生成分析」入口用 */
export async function fetchStepAnalysis(
  projectId: string,
  stageKey: string,
  round?: number,
): Promise<{ content: string; empty: boolean }> {
  const params = new URLSearchParams({ stageKey });
  if (round != null) params.set("round", String(round));
  return api.post<{ content: string; empty: boolean }>(
    `/project-management/${projectId}/analyze-step?${params.toString()}`,
  );
}

/** 项目时间轴（按轮十节点；与 :3005 项目详情/归档弹窗同源） */
export type TimelineNode = { key: string; label: string; time: string | null; timeEnd?: string | null };
export type TimelineData = { rounds: { round: number; nodes: TimelineNode[] }[]; currentRound?: number };

export async function fetchProjectTimeline(pmiId: string): Promise<TimelineData> {
  return api.get<TimelineData>(`/project-management/${pmiId}/timeline`);
}
