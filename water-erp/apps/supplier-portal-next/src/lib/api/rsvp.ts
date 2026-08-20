import { api } from "../api";

export interface RsvpView {
  supplierName: string;
  title: string;
  summary: Record<string, string>;
  projectId: string | null;
  status: "PENDING" | "ACCEPTED" | "DECLINED";
  respondedAt: string | null;
  rsvpNo: string | null;
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
