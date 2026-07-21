import { PrismaService } from '../prisma/prisma.service';

/**
 * 预算参考·置信分层估算器（方法 C）。
 *
 * 设计要点：在“单价层”归一，而非对历史项目“总价”按业务相关度加权（旧算法的缺陷：
 * 把规模/数量/规格差异当成了价格）。按数据质量分层：
 *   Tier 1 目录单价 × 目标数量（高置信，点估计+窄带）
 *   Tier 2 预算行项目单价回退（中置信，点估计+较宽带）
 *   Tier 3 历史项目范围类比 + 规模护栏（低置信，仅区间，无单点）
 *   Tier 4 拒绝估算（提示补数量/规格或选目录品）
 *
 * v1 纯确定性（不调 LLM），保证可审计、可复现。
 */

export type BudgetEstimatorLineInput = {
  name: string;
  specification?: string | null;
  unit?: string | null;
  qty?: number | null;
};

export type BudgetEstimatorInput = {
  procurementTitle: string;
  procurementCategory?: string | null;
  /** 货物/工程/服务 —— 用于历史类比检索 */
  procurementType?: string | null;
  projectReason?: string | null;
  supplierRequirements?: string | null;
  lines?: BudgetEstimatorLineInput[];
  budgetListId?: string | null;
};

export type BudgetLineMatch = 'exact' | 'contained' | 'budget' | 'none';

export type BudgetEstimatedLine = {
  name: string;
  unit: string | null;
  qty: number | null;
  match: BudgetLineMatch;
  catalogName: string | null;
  specification: string | null;
  unitPrice: number | null;
  lineLow: number | null;
  lineHigh: number | null;
  lineTotal: number | null;
  specWarning: string | null;
};

export type BudgetHistoricalBand = { min: number; max: number; median: number; count: number };

export type BudgetReferenceAdjustment = { factor: number; reason: string };

export type BudgetReferenceItem = {
  title: string;
  category: string | null;
  amount: number;
  contractAmount: number | null;
  date: string;
  method: string;
  source: string;
  heuristicScore: number;
  aiRelevance: number;
  relevance: number;
  weight: number;
  contribution: number;
  aiReason: string;
};

export type BudgetReferencePricing = {
  weightedContractPrice: number | null;
  weightedBudgetPrice: number;
  anchor: 'contract' | 'budget';
  anchorPrice: number;
  adjustmentFactor: number;
  adjustments: BudgetReferenceAdjustment[];
  clamped: boolean;
  suggestedBudget: number;
};

export type BudgetEstimatorResult = {
  hasReference: boolean;
  message: string;
  references: BudgetReferenceItem[];
  pricing: BudgetReferencePricing | null;
  suggestedBudget: number | null;
  analysis: string | null;
  confidence: number;
  confidenceReason: string;
  statistics: { average: number; max: number; min: number; count: number; avgContract: number | null } | null;
  // ── 方法 C 新增 ──
  tier: 1 | 2 | 3 | 4;
  tierLabel: string;
  rangeLow: number | null;
  rangeHigh: number | null;
  lines: BudgetEstimatedLine[];
  historicalBand: BudgetHistoricalBand | null;
};

const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(String(v));
  return Number.isFinite(n) ? n : 0;
};

const norm = (s: string | null | undefined): string =>
  (s ?? '').toLowerCase().replace(/\s+/g, '').replace(/[（()）,，。.、;；:：]/g, '');

const TIER_LABEL: Record<1 | 2 | 3 | 4, string> = {
  1: '目录单价估算',
  2: '预算单价估算',
  3: '历史区间类比',
  4: '数据不足',
};

type CatalogRow = {
  name: string;
  category: string | null;
  unit: string | null;
  specification: string | null;
  referencePrice: unknown;
  averagePrice: unknown;
  priceMin: unknown;
  priceMax: unknown;
};

/** 目录匹配：名称相等 → 互相包含；category/unit 作 tie-break 与校验。 */
function matchCatalog(lines: { name: string; unit: string | null; category: string | null; qty?: number | null; specification?: string | null }[], catalog: CatalogRow[]): BudgetEstimatedLine[] {
  const pool = catalog.map((c) => ({ c, nn: norm(c.name), cu: norm(c.unit), cc: norm(c.category) }));
  return lines.map((line) => {
    const nn = norm(line.name);
    if (!nn) return baseLine(line, 'none', null);
    const exact = pool.filter((p) => p.nn === nn);
    const contained = pool.filter((p) => p.nn.includes(nn) || nn.includes(p.nn));
    const pick = (cands: typeof pool): (typeof pool)[number] | undefined => {
      if (!cands.length) return undefined;
      const unitOk = cands.filter((p) => !line.unit || !p.cu || p.cu === norm(line.unit));
      const catOk = unitOk.filter((p) => !line.category || !p.cc || p.cc === norm(line.category));
      return catOk[0] ?? unitOk[0] ?? cands[0];
    };
    const e = pick(exact);
    if (e) return catalogLine(line, e.c, 'exact');
    const c = pick(contained);
    if (c) return catalogLine(line, c.c, 'contained');
    return baseLine(line, 'none', null);
  });
}

function baseLine(line: { name: string; unit: string | null; qty?: number | null; specification?: string | null }, match: BudgetLineMatch, catalog: CatalogRow | null): BudgetEstimatedLine {
  return {
    name: line.name,
    unit: catalog?.unit ?? line.unit ?? null,
    qty: line.qty ?? null,
    match,
    catalogName: catalog?.name ?? null,
    specification: catalog?.specification ?? line.specification ?? null,
    unitPrice: null,
    lineLow: null,
    lineHigh: null,
    lineTotal: null,
    specWarning: null,
  };
}

function catalogLine(line: { name: string; unit: string | null; qty?: number | null; specification?: string | null }, c: CatalogRow, match: 'exact' | 'contained'): BudgetEstimatedLine {
  const ref = num(c.referencePrice);
  const avg = num(c.averagePrice);
  const pmin = num(c.priceMin);
  const pmax = num(c.priceMax);
  const unitPrice = ref || avg;
  const low = pmin > 0 ? pmin : unitPrice > 0 ? Math.round(unitPrice * 0.92) : null;
  const high = pmax > 0 ? pmax : unitPrice > 0 ? Math.round(unitPrice * 1.08) : null;
  const qty = line.qty ?? null;
  // 规格一致性：仅告警，不擅自调价（避免编造质量差）。
  let specWarning: string | null = null;
  const ls = norm(line.specification);
  const cs = norm(c.specification);
  if (ls && cs && ls !== cs && !cs.includes(ls) && !ls.includes(cs)) {
    specWarning = `规格与目录项不完全一致（需求“${line.specification}” vs 目录“${c.specification}”），单价未自动调整，请人工复核`;
  }
  return {
    name: line.name,
    unit: c.unit ?? line.unit ?? null,
    qty,
    match,
    catalogName: c.name,
    specification: c.specification ?? line.specification ?? null,
    unitPrice: unitPrice > 0 ? unitPrice : null,
    lineLow: low != null && qty != null ? low * qty : null,
    lineHigh: high != null && qty != null ? high * qty : null,
    lineTotal: unitPrice > 0 && qty != null ? Math.round(unitPrice * qty) : null,
    specWarning,
  };
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** 历史范围类比 + 规模护栏：剔除 <0.3× 或 >3× 中位数的离群项目。 */
function historicalBand(budgets: number[]): BudgetHistoricalBand | null {
  const xs = budgets.filter((b) => b > 0);
  if (!xs.length) return null;
  const med = median(xs);
  const guarded = xs.filter((b) => b >= med * 0.3 && b <= med * 3);
  const use = guarded.length ? guarded : xs;
  return { min: Math.min(...use), max: Math.max(...use), median: median(use), count: use.length };
}

export async function estimateBudgetReference(prisma: PrismaService, input: BudgetEstimatorInput): Promise<BudgetEstimatorResult> {
  const title = (input.procurementTitle || '').trim();
  const category = input.procurementCategory ?? null;
  const ptype = input.procurementType ?? null;

  // 1) 行项目解析：显式 lines > budgetListId 读 BudgetItem > 标题作单行 qty=1。
  let rawLines: BudgetEstimatorLineInput[] = [];
  if (input.lines && input.lines.length) {
    rawLines = input.lines.filter((l) => (l.name || '').trim());
  } else if (input.budgetListId) {
    const items = await prisma.budgetItem.findMany({ where: { budgetListId: input.budgetListId }, orderBy: { sortOrder: 'asc' } });
    rawLines = items.map((it) => ({ name: it.name, specification: it.specification, unit: it.unit, qty: num(it.qty) || null }));
  }
  const implicitSingle = !rawLines.length && !!title;
  if (implicitSingle) rawLines = [{ name: title, specification: null, unit: null, qty: 1 }];

  // 2) 目录匹配。候选池：同类 + 名称有交集（限制规模，避免全表语义误配）。
  let catalog: CatalogRow[] = [];
  if (rawLines.length) {
    // 注意：Prisma `contains` 作用于“原始库值”，故 DB 预过滤必须用“原始名前缀”（保留大小写/空格），
    // 不能传归一化串（否则 “aqms-900环境” 无法匹配库值 “AQMS-900 环境…”）。归一化仅用于内存匹配。
    const rawPrefixes = [...new Set(rawLines.map((l) => (l.name || '').trim().slice(0, 12)).filter((s) => s.length >= 2))];
    catalog = await prisma.catalogItem.findMany({
      where: {
        status: '有效',
        ...(category ? { OR: [{ category }, { group: category }] } : {}),
      },
      select: { name: true, category: true, unit: true, specification: true, referencePrice: true, averagePrice: true, priceMin: true, priceMax: true },
      take: 2000,
    });
    // 名称包含的全局检索不限品类 —— 型号名（如“AQMS-900 …”）常与入参 category 不在同一品类目录，
    // 这里故意不加 category 过滤，确保跨品类也能按型号精确命中目录单价。
    if (rawPrefixes.length) {
      const extra = await prisma.catalogItem.findMany({
        where: { status: '有效', OR: rawPrefixes.map((p) => ({ name: { contains: p } })) },
        select: { name: true, category: true, unit: true, specification: true, referencePrice: true, averagePrice: true, priceMin: true, priceMax: true },
        take: 300,
      });
      const seen = new Set(catalog.map((c) => c.name));
      for (const e of extra) if (!seen.has(e.name)) catalog.push(e);
    }
  }

  const lines = matchCatalog(
    rawLines.map((l) => ({ name: l.name, unit: l.unit ?? null, category, qty: l.qty ?? null, specification: l.specification ?? null })),
    catalog,
  );

  // 3) 预算行项目单价回退（Tier 2 来源）：对 match=none 的行，按名称找 BudgetItem.referencePrice。
  const budgetRows = await prisma.budgetItem.findMany({
    where: { name: { in: rawLines.map((l) => l.name.trim()).filter(Boolean) } },
    select: { name: true, unit: true, specification: true, referencePrice: true },
    take: 500,
  });
  for (const est of lines) {
    if (est.match !== 'none' || est.unitPrice) continue;
    const br = budgetRows.find((b) => norm(b.name) === norm(est.name));
    if (br && num(br.referencePrice) > 0) {
      const up = num(br.referencePrice);
      est.match = 'budget';
      est.unitPrice = up;
      est.unit = est.unit ?? br.unit;
      est.specification = est.specification ?? br.specification;
      if (est.qty != null) {
        est.lineTotal = Math.round(up * est.qty);
        est.lineLow = Math.round(up * 0.9 * est.qty);
        est.lineHigh = Math.round(up * 1.1 * est.qty);
      }
    }
  }

  const withPrice = lines.filter((l) => l.unitPrice && l.unitPrice > 0 && l.qty != null && l.qty > 0);
  const allResolved = lines.length > 0 && lines.every((l) => (l.match === 'exact' || l.match === 'contained') && l.unitPrice && l.qty != null);
  const someResolved = withPrice.length > 0;

  // 4) 历史范围类比（Tier 3 来源 / 交叉校验）。语料 = 项目管理台账 ProjectManagementItem（含预算/合同总价）。
  const hist = await prisma.projectManagementItem.findMany({
    where: { budgetAmount: { gt: 0 }, status: { in: ['ACTIVE', 'ARCHIVED'] } },
    select: { title: true, budgetAmount: true, contractAmount: true, procurementCategory: true, procurementMethod: true, createdAt: true },
    take: 800,
  });
  const ntitle = norm(title);
  const ncat = norm(category);
  // 历史“相关”判定：标题重叠是硬条件（最长公共子串≥4，或一方包含另一方）；
  // 品类对齐仅作加分（把门槛降到≥2 字重叠），避免“其他/设备”等泛品类成为无关标题的后门。
  // 重叠子串若仅为停用词（采购/项目/服务/设备/工程/系统/…）则不算“实质重叠”，
  // 否则泛品类 + “采购”二字会让无关标题混入历史类比。
  const STOP_RUNS = ['采购', '项目', '服务', '设备', '工程', '系统', '材料', '物资', '货物', '相关', '技术', '合同'];
  const longestRun = (a: string, b: string): number => {
    if (!a || !b) return 0;
    const step = a.length <= b.length ? a : b;
    const hay = a.length <= b.length ? b : a;
    for (let len = Math.min(step.length, 8); len >= 2; len--) {
      for (let i = 0; i <= step.length - len; i++) {
        const w = step.slice(i, i + len);
        if (hay.includes(w) && !STOP_RUNS.includes(w)) return len;
      }
    }
    return 0;
  };
  const related = hist.filter((h) => {
    const ht = norm(h.title);
    if (!ntitle || !ht) return false;
    if (ht.includes(ntitle) || ntitle.includes(ht)) return true;
    const run = longestRun(ntitle, ht);
    if (run >= 4) return true;
    const hc = norm(h.procurementCategory);
    const catOk = !!(ncat && hc && (hc === ncat || hc.includes(ncat) || ncat.includes(hc)));
    return catOk && run >= 2;
  });
  // 无相关历史时不再退化为全表（否则无关标题也会拿到假区间）→ 直接无 band。
  const budgets = related.map((h) => num(h.budgetAmount));
  const band = historicalBand(budgets);

  // 5) 分层定档。
  let tier: 1 | 2 | 3 | 4;
  if (allResolved) tier = 1;
  else if (someResolved) tier = 2;
  else if (band) tier = 3;
  else tier = 4;

  // 6) 点估计 / 区间 / 置信。
  const point = withPrice.length ? withPrice.reduce((s, l) => s + (l.lineTotal ?? 0), 0) : null;
  const sumLow = withPrice.length ? withPrice.reduce((s, l) => s + (l.lineLow ?? (l.lineTotal ?? 0)), 0) : null;
  const sumHigh = withPrice.length ? withPrice.reduce((s, l) => s + (l.lineHigh ?? (l.lineTotal ?? 0)), 0) : null;

  const rangeLow = tier <= 2 ? sumLow : band ? band.min : null;
  const rangeHigh = tier <= 2 ? sumHigh : band ? band.max : null;
  const suggested = tier <= 2 ? point : null; // Tier 3/4 不给假精确单点

  const specWarnings = lines.filter((l) => l.specWarning);
  const containedCount = lines.filter((l) => l.match === 'contained').length;
  let confidence = 0;
  let confidenceReason = '';
  if (tier === 1) {
    confidence = Math.max(0.55, 0.9 - containedCount * 0.1 - specWarnings.length * 0.1);
    confidenceReason = `命中 ${lines.length} 个目录单价项（${lines.filter((l) => l.match === 'exact').length} 精确 / ${containedCount} 近似）`;
  } else if (tier === 2) {
    confidence = Math.max(0.35, 0.6 - specWarnings.length * 0.1);
    confidenceReason = `${withPrice.length}/${lines.length} 行有单价（含预算单价回退），其余行未计价`;
  } else if (tier === 3) {
    confidence = Math.min(0.4, 0.15 + (band?.count ?? 0) * 0.05);
    confidenceReason = `无可用单价，仅 ${band?.count ?? 0} 个历史项目作范围类比（已做规模护栏），请补数量/规格或选目录品`;
  } else {
    confidence = 0;
    confidenceReason = '未匹配到目录/预算单价，也无历史可比项目';
  }
  if (implicitSingle && tier <= 2) confidenceReason += '；数量按 1 计（未提供数量，请在清单中补 qty）';

  // 7) 向后兼容字段：references / pricing / statistics / adjustments。
  const references: BudgetReferenceItem[] = [];
  for (const l of withPrice) {
    references.push({
      title: l.catalogName ?? l.name,
      category,
      amount: l.unitPrice ?? 0,
      contractAmount: null,
      date: new Date().toISOString(),
      method: '目录单价',
      source: l.match === 'budget' ? '预算单价' : '电子商城目录',
      heuristicScore: l.match === 'exact' ? 1 : l.match === 'contained' ? 0.7 : 0.5,
      aiRelevance: l.match === 'exact' ? 1 : 0.7,
      relevance: l.match === 'exact' ? 1 : 0.7,
      weight: 0,
      contribution: l.lineTotal ?? 0,
      aiReason: l.specWarning ?? `目录${l.match === 'exact' ? '精确' : '近似'}匹配，单价 ${l.unitPrice}/${l.unit ?? '单位'}`,
    });
  }
  if (tier >= 3 && band) {
    related
      .filter((h) => num(h.budgetAmount) >= band.min && num(h.budgetAmount) <= band.max)
      .slice(0, 5)
      .forEach((h, i) => {
        references.push({
          title: h.title,
          category: h.procurementCategory,
          amount: num(h.budgetAmount),
          contractAmount: h.contractAmount != null ? num(h.contractAmount) : null,
          date: h.createdAt.toISOString(),
          method: h.procurementMethod || '历史类比',
          source: '项目管理',
          heuristicScore: 0.3,
          aiRelevance: 0.3,
          relevance: 0.3,
          weight: 0,
          contribution: 0,
          aiReason: i === 0 ? '仅作范围类比，规模护栏后参与区间，不作点估计' : '历史范围类比',
        });
      });
  }
  const total = withPrice.reduce((s, l) => s + (l.lineTotal ?? 0), 0) || 1;
  references.forEach((r) => { if (r.source !== '历史类比') r.weight = Number(((r.contribution / total) || 0).toFixed(2)); });

  const adjustments: BudgetReferenceAdjustment[] = [];
  for (const l of specWarnings) adjustments.push({ factor: 0, reason: l.specWarning ?? '' });
  if (implicitSingle && tier <= 2) adjustments.push({ factor: 0, reason: '未提供数量，按 1 计；多数量请在清单中传 qty' });
  if (!adjustments.length && tier <= 2) adjustments.push({ factor: 0, reason: '与目录单价基准一致，无规模外推' });

  const unitPrices = withPrice.map((l) => l.unitPrice ?? 0).filter((x) => x > 0);
  const statistics = band
    ? { average: Math.round(band.median), max: band.max, min: band.min, count: band.count, avgContract: null }
    : unitPrices.length
      ? { average: Math.round(unitPrices.reduce((a, b) => a + b, 0) / unitPrices.length), max: Math.max(...unitPrices), min: Math.min(...unitPrices), count: unitPrices.length, avgContract: null }
      : null;

  const pricing: BudgetReferencePricing | null = tier <= 2 && suggested != null
    ? {
        weightedContractPrice: null,
        weightedBudgetPrice: suggested,
        anchor: 'budget',
        anchorPrice: suggested,
        adjustmentFactor: 1,
        adjustments,
        clamped: false,
        suggestedBudget: suggested,
      }
    : null;

  const analysis = buildAnalysis(tier, lines, withPrice, band, suggested, implicitSingle);

  return {
    hasReference: tier <= 3,
    message: tier === 4 ? '未找到可比目录/预算单价或历史项目，无法估算' : tier <= 2 ? `按${TIER_LABEL[tier]}估算 ${lines.length} 行` : `无可用单价，给出 ${band?.count ?? 0} 个历史项目的参考区间`,
    references,
    pricing,
    suggestedBudget: suggested,
    analysis,
    confidence: Number(confidence.toFixed(2)),
    confidenceReason,
    statistics,
    tier,
    tierLabel: TIER_LABEL[tier],
    rangeLow: rangeLow != null ? Math.round(rangeLow) : null,
    rangeHigh: rangeHigh != null ? Math.round(rangeHigh) : null,
    lines,
    historicalBand: band,
  };
}

function buildAnalysis(tier: 1 | 2 | 3 | 4, lines: BudgetEstimatedLine[], withPrice: BudgetEstimatedLine[], band: BudgetHistoricalBand | null, suggested: number | null, implicitSingle: boolean): string | null {
  if (tier === 4) return '当前需求未匹配到电子商城目录单价、预算单价，也没有可类比的历史项目，建议补充采购数量与技术规格，或从目录选取标准品后重试。';
  if (tier <= 2) {
    const detail = withPrice.map((l) => `${l.catalogName ?? l.name} ${l.unitPrice}/${l.unit ?? ''} × ${l.qty}`).join('；');
    return `采用${TIER_LABEL[tier]}（自下而上）：按行项目“目录/预算单价 × 数量”求和，避免用历史项目总价直接加权导致的规模失真。明细：${detail}。合计建议 ${suggested?.toLocaleString()} 元。${implicitSingle ? '（未提供数量，按 1 计）' : ''}`;
  }
  return `无可用单价，仅以 ${band?.count ?? 0} 个历史项目作范围类比（已剔除规模为中位数 0.3× 以下或 3× 以上的离群项目），参考区间 ${band?.min.toLocaleString()}–${band?.max.toLocaleString()} 元。该区间含规模差异，不宜直接作为单点预算，建议补充数量/规格或匹配目录品以获得单价估算。`;
}
