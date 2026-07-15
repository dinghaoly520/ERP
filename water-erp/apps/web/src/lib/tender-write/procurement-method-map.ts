import type { TenderDocumentType } from '@/lib/types/tender-write';

/**
 * 项目采购方式 → 采购文件编写类型映射
 * 仅映射有对应编写模板的采购方式
 */
export function mapProcurementMethodToTenderType(
  method: string | null | undefined,
): TenderDocumentType | null {
  const map: Record<string, TenderDocumentType> = {
    谈判采购: 'COMPETITIVE_NEGOTIATION',
    竞价采购: 'INTERNAL_BIDDING',
    邀请招标: 'INVITED_BIDDING',
    询比采购: 'INQUIRY_PURCHASE',
    直接采购: 'SINGLE_SOURCE',
  };
  return method ? (map[method] ?? null) : null;
}
