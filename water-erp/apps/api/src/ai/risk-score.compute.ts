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

/* ── C8 履约违约风险预测（规则 + 诚实置信度，非 LLM）──────────────────
   用于准入→淘汰衔接：对评价时序呈现 D 级 / 连续低分 / 下滑趋势的供应商，
   预测其下阶段违约/失约风险，触发主动预警（把被动淘汰变主动风控）。
   置信度 = 数据覆盖率：评价次数越多置信越高，无数据时明确低置信，绝不编造。 */
export interface DefaultRiskInput {
  /** 评价时间序列，按时间升序，元素为总分(0-100)与等级 */
  evalSeries: { score: number; level: string }[];
  expiredQualifications: number;
}
export interface DefaultRiskPrediction {
  riskScore: number;        // 0-100，越高越可能违约/失约
  level: '低风险' | '中风险' | '高风险' | '未知';
  confidence: number;       // 0-100，数据覆盖率
  drivers: string[];        // 命中的风险驱动因素（可解释）
  narrative: string;        // 一句话风险叙事
}

export function predictDefaultRisk(i: DefaultRiskInput): DefaultRiskPrediction {
  const n = i.evalSeries.length;
  // 置信度（P1-26 下压）：无评价=5，1 次=20，2 次=35，≥3 次才过 50，封顶 90——单点评价不足以建立信心。
  const confidence = n === 0 ? 5 : n === 1 ? 20 : n === 2 ? 35 : Math.min(90, 50 + (n - 3) * 10);

  const drivers: string[] = [];
  let risk = 20; // 基线：无信号时偏低风险

  const recent = i.evalSeries.slice(-3);
  const hasD = recent.some((e) => e.level === 'D');
  const lowStreak = recent.length >= 2 && recent.every((e) => e.score < 60);
  // 趋势：比较近半与远半均分，下滑 > 8 分视为恶化。
  let declining = false;
  if (n >= 4) {
    const half = Math.floor(n / 2);
    const earlyAvg = i.evalSeries.slice(0, half).reduce((s, e) => s + e.score, 0) / half;
    const lateAvg = i.evalSeries.slice(half).reduce((s, e) => s + e.score, 0) / (n - half);
    declining = earlyAvg - lateAvg > 8;
  }

  if (hasD) { risk += 35; drivers.push('近期出现 D 级（不合格）评价'); }
  if (lowStreak) { risk += 25; drivers.push('连续评价低于 60 分'); }
  if (declining) { risk += 20; drivers.push('评分呈下滑趋势'); }
  if (i.expiredQualifications > 0) { risk += 15; drivers.push(`存在 ${i.expiredQualifications} 项过期资质，投标/履约资格受限`); }
  if (n === 0) drivers.push('暂无评价记录，履约表现未知（低置信）');

  risk = clamp01(risk);
  // #16 数据不足（无评价）时不得标「低风险」误导——单独「未知」档，由消费方据此提示而非当作低风险放行。
  const level: DefaultRiskPrediction['level'] =
    n === 0 ? '未知' : risk >= 65 ? '高风险' : risk >= 40 ? '中风险' : '低风险';
  const narrative =
    n === 0
      ? '该供应商尚无评价记录，无法可靠预测违约风险，建议先发起评价建立履约档案后再评估。'
      : `综合近 ${recent.length} 次评价与资质状态，违约/失约风险为${level}（风险分 ${risk}）；${drivers.length ? drivers.join('；') : '未发现明显恶化信号'}。`;

  return { riskScore: risk, level, confidence, drivers, narrative };
}
