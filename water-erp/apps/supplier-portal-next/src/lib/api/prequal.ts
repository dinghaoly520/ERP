import { api } from "../api";

/** B3（GB/T 43711 7.2.3）：供应商侧资格预审 */
export interface PrequalListItem {
  id: string;
  title: string;
  mode: "centralized" | "single";
  method: "qualified" | "limited";
  limitedCount?: number | null;
  validUntil?: string | null;
  createdAt: string;
  myStatus: "pending" | "passed" | "failed" | null;
}

export const prequalApi = {
  list() {
    return api.get<PrequalListItem[]>("/supplier-portal/prequals");
  },
  apply(id: string, note?: string) {
    return api.post<unknown>(`/supplier-portal/prequals/${id}/apply`, { note });
  },
};
