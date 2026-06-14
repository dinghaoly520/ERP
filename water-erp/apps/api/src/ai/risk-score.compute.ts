export interface RiskFactorInput {
  decryptStatus: string;
  fileCount: number;
  fileTotal: number;
  validQualifications: number;
  expiredQualifications: number;
  bidPrice: number | null;
  budget: number | null;
  perfAvg: number | null;
  perfCount: number;
}
export interface RiskFactor {
  name: string;
  score: number;
  detail: string;
  backedByData: boolean;
}

export function clamp01(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function computeRiskFactors(i: RiskFactorInput): RiskFactor[] {
  // 文件完整性
  const ratio = i.fileTotal > 0 ? i.fileCount / i.fileTotal : 0;
  const fileScore = clamp01(ratio * 100);

  // 解密状态
  const decryptScore = i.decryptStatus === 'SUCCESS' ? 100 : i.decryptStatus === 'DANGER' ? 20 : 50;

  // 资质合规
  const totalQual = i.validQualifications + i.expiredQualifications;
  const qualScore = totalQual === 0 ? 40
    : clamp01((i.validQualifications / totalQual) * 100 - (i.expiredQualifications > 0 ? 5 : 0));

  // 报价风险（偏离预算 ±5% 内为优）
  let priceScore = 50;
  let priceDetail = '无报价/预算数据';
  if (i.bidPrice != null && i.budget != null && i.budget > 0) {
    const dev = Math.abs(i.bidPrice - i.budget) / i.budget; // 偏离比例
    priceScore = clamp01(100 - dev * 200); // 偏离 0%=100, 50%=0
    priceDetail = `偏离预算 ${(dev * 100).toFixed(1)}%`;
  }

  // 历史履约
  let perfScore = 50;
  let perfDetail = '无履约数据';
  if (i.perfCount > 0 && i.perfAvg != null) {
    perfScore = clamp01(i.perfAvg);
    perfDetail = `历史均分 ${i.perfAvg.toFixed(1)}（${i.perfCount} 次）`;
  }

  return [
    { name: '文件完整性', score: fileScore, detail: `${i.fileCount}/${i.fileTotal} 件齐全`, backedByData: i.fileTotal > 0 },
    { name: '解密状态', score: decryptScore, detail: i.decryptStatus, backedByData: true },
    { name: '资质合规', score: qualScore, detail: `有效 ${i.validQualifications} / 过期 ${i.expiredQualifications}`, backedByData: totalQual > 0 },
    { name: '报价风险', score: priceScore, detail: priceDetail, backedByData: i.bidPrice != null && i.budget != null },
    { name: '历史履约', score: perfScore, detail: perfDetail, backedByData: i.perfCount > 0 },
  ];
}

export function riskLevel(overall: number): '低风险' | '中风险' | '高风险' {
  return overall >= 85 ? '低风险' : overall >= 65 ? '中风险' : '高风险';
}
