import { api, qs } from "../api";

/**
 * C6（GB/T 43711 4.2.2）：供应商异议/投诉。
 * phase：document 采购文件 | prequalification 资格预审 | result 采购结果；
 * status：open 待答复 → answered 已答复（可转投诉）→ complaint 已转投诉 → closed 已办结。
 */
export interface SupplierObjection {
  id: string;
  announcementId?: string | null;
  projectCode?: string | null;
  phase: "document" | "prequalification" | "result";
  title: string;
  content: string;
  status: "open" | "answered" | "complaint" | "closed";
  answer?: string | null;
  answeredByName?: string | null;
  answeredAt?: string | null;
  escalationNote?: string | null;
  createdAt: string;
}

export const objectionApi = {
  /** 我的异议（后端分页 + 状态筛选；status 传 "all" 表示全部） */
  listMine(params: { page?: number; pageSize?: number; status?: string } = {}) {
    return api.get<{ items: SupplierObjection[]; total: number }>(
      `/supplier-portal/objections${qs({ page: params.page, pageSize: params.pageSize, status: params.status })}`,
    );
  },
  create(payload: { announcementId?: string; projectCode?: string; phase: string; title: string; content: string }) {
    return api.post<SupplierObjection>("/supplier-portal/objections", payload);
  },
};
