import { api } from "../api";

export interface RsvpView {
  supplierName: string;
  title: string;
  summary: Record<string, string>;
  projectId: string | null;
  status: "PENDING" | "ACCEPTED" | "DECLINED";
  respondedAt: string | null;
  rsvpNo: string | null;
  /** 作答方（2026-10-21 用户口径：代回应/代变更的行不展示回执号——回执号是供应商自答凭证） */
  respondentType?: "SUPPLIER" | "STAFF" | "SYSTEM" | null;
  /** 供应商自答快照（代变更不覆盖原回执——本人视角展示自己的回执时刻与原选择） */
  supplierRespondedAt?: string | null;
  supplierStatus?: "ACCEPTED" | "DECLINED" | null;
  expired: boolean;
  expiresAt: string;
}

export interface RsvpRespondResult {
  success: boolean;
  status: "ACCEPTED" | "DECLINED";
  respondedAt: string;
  rsvpNo: string;
}

// 公开（无登录）：校验回执链接，返回展示信息（含供应商名称 + 关键信息）+ 当前状态
export const verifyRsvp = (t: string) =>
  api.get<RsvpView>(`/supplier/rsvp/verify?t=${encodeURIComponent(t)}`, { silent: true });

// 公开（无登录）：提交回执（幂等，可改主意）
export const respondRsvp = (t: string, status: "ACCEPTED" | "DECLINED", note?: string) =>
  api.post<RsvpRespondResult>(`/supplier/rsvp/respond?t=${encodeURIComponent(t)}`, { status, note }, { silent: true });
