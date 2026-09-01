/* A-104：保证金符合性自动比对（到账台账 × 招标要求 × 唱标录入状态）——前后端共用 */
export interface BondLedgerComplianceInput {
  hasLedger: boolean;
  amount: number | null;         // 台账到账金额（元）
  arrivedAt: string | null;      // ISO 到账时间
  payMethod: string | null;      // 转账/保函/支票/其他
  requiredAmount: number | null; // BidProject.bondAmount（null=未设要求，不比对）
  deadline: string | null;       // 截标时间（ISO；到账截止按截标口径，保函行=递交时间同基准）
  bondStatus: string | null;     // 唱标录入状态（已缴纳/保函有效/…，null=未录入）
  hasVoucher?: boolean | null;   // 是否已上传缴纳凭证（false=缺凭证；null/undefined=不在核验上下文，跳过该维）
}
export interface BondComplianceIssue { field: 'LEDGER_MISSING' | 'AMOUNT' | 'ARRIVAL' | 'PAY_METHOD' | 'VOUCHER'; message: string }

export function evaluateBondCompliance(input: BondLedgerComplianceInput): BondComplianceIssue[] {
  if (!input.hasLedger) {
    const voucherMissing = input.hasVoucher === false ? [{ field: 'VOUCHER', message: '未上传保证金缴纳凭证' } as BondComplianceIssue] : [];
    return [{ field: 'LEDGER_MISSING', message: '未登记到账台账' }, ...voucherMissing];
  }
  const issues: BondComplianceIssue[] = [];
  if (input.hasVoucher === false) issues.push({ field: 'VOUCHER', message: '未上传保证金缴纳凭证' });
  if (input.requiredAmount != null && input.amount != null && input.amount < input.requiredAmount) {
    issues.push({ field: 'AMOUNT', message: `到账金额 ${input.amount} 元，不足要求 ${input.requiredAmount} 元` });
  }
  if (input.deadline && input.arrivedAt && new Date(input.arrivedAt).getTime() > new Date(input.deadline).getTime()) {
    issues.push({ field: 'ARRIVAL', message: `到账时间晚于截标时间（到账 ${input.arrivedAt}，截标 ${input.deadline}）` });
  }
  if (input.payMethod === '保函' && input.bondStatus === '已缴纳') {
    issues.push({ field: 'PAY_METHOD', message: '台账支付形式为保函，唱标应录「保函有效」而非「已缴纳」' });
  }
  if (input.payMethod && input.payMethod !== '保函' && input.bondStatus === '保函有效') {
    issues.push({ field: 'PAY_METHOD', message: `台账支付形式为${input.payMethod}，唱标录入为「保函有效」不一致` });
  }
  return issues;
}
