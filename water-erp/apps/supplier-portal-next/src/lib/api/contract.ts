import { api } from "../api";

/** C2/C3（GB/T 43711 7.5.4/7.6）：供应商侧合同与履行台账 */
export interface SpContractFulfillment {
  id: string;
  type: "delivery" | "payment" | "acceptance";
  title: string;
  dueDate?: string | null;
  doneDate?: string | null;
  amount?: number | null;
  status: "pending" | "done" | "exception";
  proofAssetId?: string | null;
  note?: string | null;
}

export interface SpContract {
  id: string;
  contractCode: string;
  projectCode: string;
  contractType: "standard" | "order";
  status: "approved_for_signing" | "signed" | "performing" | "accepted" | "terminated";
  amount?: number | null;
  signedAt?: string | null;
  signedAssetId?: string | null;
  fulfillments: SpContractFulfillment[];
  createdAt: string;
}

export const contractApi = {
  listMine() {
    return api.get<SpContract[]>("/supplier-portal/contracts");
  },
  attachProof(contractId: string, fulfillmentId: string, proofAssetId: string) {
    return api.post<SpContractFulfillment>(`/supplier-portal/contracts/${contractId}/fulfillments/${fulfillmentId}/proof`, { proofAssetId });
  },
};

export function contractAssetUrl(assetId: string | null | undefined): string | null {
  return assetId ? `/api/upload/files/${encodeURIComponent(assetId)}` : null;
}
