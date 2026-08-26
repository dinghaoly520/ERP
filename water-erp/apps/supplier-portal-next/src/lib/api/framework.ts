import { api } from "../api";

/** B4（GB/T 43711 附录 D）：供应商侧——我入围的框架协议 */
export interface MyFaEntry {
  entryId: string;
  status: "active" | "supplemented" | "exited";
  shareRatio?: number | null;
  entryAt: string;
  fa: {
    id: string;
    faCode: string;
    title: string;
    variant: "supplier_only" | "supplier_price" | "supplier_price_qty";
    validUntil: string;
    status: string;
    priceRule?: Record<string, any> | null;
    quotaRule?: Record<string, any> | null;
    secondStageRule?: string | null;
  };
}

export const frameworkApi = {
  listMine() {
    return api.get<MyFaEntry[]>("/supplier-portal/framework-agreements");
  },
};
