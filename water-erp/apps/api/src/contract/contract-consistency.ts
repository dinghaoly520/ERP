/**
 * C2（GB/T 43711 7.5.4.3）：合同实质性内容一致性校验（纯函数）。
 * 采购合同的实质性内容应与采购文件、成交供应商的响应文件和成交通知书一致。
 * 数据来源（按可得性逐项比对，取得到的源）：
 *  - BidEvaluationResult rank1 recommended（线上评审：成交人 + bidPrice 报价）
 *  - AwardLetterDelivery.content（成交通知书：winner/price）
 *  - 成交公告/预成交公示 metadata.winner（登记制：supplierName/price）
 * 线下成交且无任何线上成交记录 → 标记 manualConfirm=true，由经办人工确认（留痕）。
 */

export interface ContractLike {
  supplierName: string;
  amount?: number | string | null;
}

export interface AwardSource {
  from: 'evaluation' | 'award_letter' | 'announcement' | 'none';
  supplierName?: string | null;
  price?: number | string | null;
}

export interface ConsistencyIssue {
  field: 'supplier' | 'amount';
  expected: string;
  actual: string;
}

export interface ConsistencyResult {
  checkedAt: string;
  /** 是否存在可自动比对的成交源 */
  manualConfirm: boolean;
  source: AwardSource['from'];
  consistent: boolean;
  issues: ConsistencyIssue[];
}

const toNum = (v: number | string | null | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

export function checkContractConsistency(contract: ContractLike, source: AwardSource): ConsistencyResult {
  const issues: ConsistencyIssue[] = [];

  if (source.from === 'none') {
    // 线下成交：无线上成交记录可比对，转人工确认（7.5.2.7 决策留痕精神）
    return { checkedAt: new Date().toISOString(), manualConfirm: true, source: 'none', consistent: true, issues: [] };
  }

  if (source.supplierName && source.supplierName.trim() && source.supplierName.trim() !== contract.supplierName.trim()) {
    issues.push({ field: 'supplier', expected: source.supplierName, actual: contract.supplierName });
  }

  const srcPrice = toNum(source.price);
  const ctrAmount = toNum(contract.amount);
  if (srcPrice != null && ctrAmount != null) {
    // 金额容差：分以下舍入后比对（避免 Decimal 序列化尾差）
    if (Math.abs(srcPrice - ctrAmount) >= 0.01) {
      issues.push({ field: 'amount', expected: String(srcPrice), actual: String(ctrAmount) });
    }
  }
  // 任一侧金额缺失不视为不一致（登记制合同金额可能后补），由人工复核

  return {
    checkedAt: new Date().toISOString(),
    manualConfirm: false,
    source: source.from,
    consistent: issues.length === 0,
    issues,
  };
}
