import { api } from '../api';

/** 供应商目录供货申请（管理员审核视角） */
export interface CatalogApplication {
  id: string;
  supplierId: string;
  type: 'NEW_ITEM' | 'JOIN_EXISTING' | 'UPDATE_QUOTE';
  catalogItemId: string | null;
  proposedName?: string | null;
  proposedSpec?: string | null;
  proposedCategory?: string | null;
  proposedGroup?: string | null;
  proposedUnit?: string | null;
  quotedPrice: number | null;
  deliveryPeriod?: string | null;
  region?: string | null;
  minOrder?: string | null;
  taxIncluded: boolean;
  freightIncluded: boolean;
  counterPrice: number | null;
  counterNote?: string | null;
  qualificationNote?: string | null;
  status: 'PENDING' | 'COUNTERED' | 'RETURNED' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  rejectReason?: string | null;
  reviewerNote?: string | null;
  approvedReferencePrice?: number | null;
  approvedPriceMin?: number | null;
  approvedPriceMax?: number | null;
  approvedValidUntil?: string | null;
  createdAt: string;
  updatedAt: string;
  supplier: { id: string; name: string; userId: string; status: string };
  catalogItem?: {
    id: string; code: string; name: string; specification: string;
    category: string; group: string; unit: string;
  } | null;
}

export function listCatalogApplications(params: { status?: string; type?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.type) qs.set('type', params.type);
  const query = qs.toString();
  return api.get<CatalogApplication[]>(`/catalog/applications${query ? '?' + query : ''}`);
}

export function reviewCatalogApplication(
  id: string,
  body: {
    action: 'approve' | 'reject' | 'return' | 'counter';
    reason?: string;
    counterPrice?: number;
    counterNote?: string;
    finalPrice?: number;
    referencePrice?: number;
    priceMin?: number;
    priceMax?: number;
    validUntil?: string;
    code?: string;
    reviewerNote?: string;
  },
) {
  return api.post<CatalogApplication>(`/catalog/applications/${id}/review`, body);
}
