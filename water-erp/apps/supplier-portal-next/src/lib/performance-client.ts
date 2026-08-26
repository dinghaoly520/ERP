import { api } from "./api";

/** E1（GB/T 43711 9.2）：供应商满意度简表（1-5 分，每供应商每项目一次，可改评） */
export function submitSatisfaction(data: { projectCode: string; score: number; comment?: string }) {
  return api.post<unknown>("/supplier-portal/satisfaction", data);
}
