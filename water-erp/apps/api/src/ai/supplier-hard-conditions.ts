/*
 * 供应商硬性筛选条件——资质字典 + 三态核验引擎（纯函数，无 IO）。
 * 三态语义（2026-11-04 用户裁定，spec docs/superpowers/specs/2026-11-04-supplier-requirement-hard-conditions-design.md）：
 *   PASS=库内资料核验满足 / FAIL=不满足（必须级剔除进 filteredOut）/ MISSING=资料缺失（保留标黄，人工判断）。
 * 词表口径：行业=库内 Supplier.industry 聚合（26 标准值）；资质=本文件内置字典（加项=改代码，勿建 DB 表）。
 */

export interface HardConditions {
  industries?: string[];
  qualifications?: { key: string; required: boolean }[];
  performance?: { years?: number; minCount?: number; keywords?: string[] };
  minGrade?: 'A' | 'B' | 'C';
}

export interface ConditionCheck {
  type: 'industry' | 'qualification' | 'performance' | 'grade';
  label: string;
  status: 'PASS' | 'FAIL' | 'MISSING';
  detail?: string;
  required: boolean; // 必须级 FAIL 才剔除；「优先」级仅展示
}

/** 结构类型：Prisma supplier 行（含 qualifications/performances include）可直接传入 */
export interface HardConditionSupplierData {
  id: string;
  name: string;
  industry?: string | null;
  qualifications: { name: string; validTo?: Date | string | null }[];
  performances: { projectName: string; description?: string | null; signDate?: Date | null; createdAt: Date }[];
}

/** 内置资质字典：keywords 为同义变体（小写包含匹配），匹配对象是供应商自报资质名 */
export const QUALIFICATION_DICTIONARY: { key: string; label: string; category: string; keywords: string[] }[] = [
  { key: 'iso9001', label: 'ISO9001 质量管理体系认证', category: '体系认证', keywords: ['iso9001', 'iso 9001', 'iso9001：2015', '质量管理体系认证', 'gb/t19001'] },
  { key: 'iso14001', label: 'ISO14001 环境管理体系认证', category: '体系认证', keywords: ['iso14001', 'iso 14001', '环境管理体系认证'] },
  { key: 'iso45001', label: 'ISO45001 职业健康安全管理体系认证', category: '体系认证', keywords: ['iso45001', 'iso 45001', '职业健康安全管理体系认证', 'ohsas18001'] },
  { key: 'hightech', label: '高新技术企业', category: '企业资质', keywords: ['高新技术企业'] },
  { key: 'safety_production', label: '安全生产许可证', category: '许可证书', keywords: ['安全生产许可证'] },
  { key: 'special_equipment', label: '特种设备生产/制造许可证', category: '许可证书', keywords: ['特种设备'] },
  { key: 'ccc', label: 'CCC 强制性产品认证', category: '产品认证', keywords: ['ccc', '3c认证', '强制性产品认证'] },
  { key: 'survey', label: '工程勘察资质', category: '行业资质', keywords: ['工程勘察'] },
  { key: 'design', label: '工程设计资质', category: '行业资质', keywords: ['工程设计', '设计资质'] },
  { key: 'construction_general', label: '建筑工程施工总承包资质', category: '行业资质', keywords: ['施工总承包'] },
  { key: 'water_conservancy', label: '水利水电工程施工资质', category: '行业资质', keywords: ['水利水电'] },
  { key: 'surveying_mapping', label: '测绘资质', category: '行业资质', keywords: ['测绘'] },
  { key: 'geological_hazard', label: '地质灾害防治单位资质', category: '行业资质', keywords: ['地质灾害'] },
  { key: 'power_install', label: '电力设施承装（修、试）许可证', category: '许可证书', keywords: ['承装', '承修', '承试'] },
  { key: 'cma', label: '检验检测机构资质认定（CMA）', category: '产品认证', keywords: ['cma', '检验检测机构资质'] },
  { key: 'cnas', label: '实验室认可（CNAS）', category: '产品认证', keywords: ['cnas', '实验室认可'] },
  { key: 'supervision', label: '工程监理资质', category: '行业资质', keywords: ['监理'] },
  { key: 'aaa_credit', label: 'AAA 信用等级', category: '企业资质', keywords: ['aaa', '信用等级', '资信等级'] },
];

const GRADE_SCORE: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, E: 1 };

export function hardConditionsEmpty(c: HardConditions | undefined): boolean {
  if (!c) return true;
  if (c.industries && c.industries.length > 0) return false;
  if (c.qualifications && c.qualifications.length > 0) return false;
  if (
    c.performance &&
    (c.performance.years != null ||
      c.performance.minCount != null ||
      (c.performance.keywords && c.performance.keywords.length > 0))
  ) {
    return false;
  }
  if (c.minGrade) return false;
  return true;
}

export function verifySupplierHardConditions(
  s: HardConditionSupplierData,
  c: HardConditions,
  latestGrade?: string | null,
): ConditionCheck[] {
  const checks: ConditionCheck[] = [];

  // ── 行业：命中=PASS / 未命中=FAIL / 未填=MISSING ──
  if (c.industries && c.industries.length > 0) {
    const label = `行业（${c.industries.join('、')}）`;
    const ind = (s.industry || '').trim();
    if (!ind) {
      checks.push({ type: 'industry', label, status: 'MISSING', detail: '库内未见该供应商行业资料', required: true });
    } else if (c.industries.includes(ind)) {
      checks.push({ type: 'industry', label, status: 'PASS', required: true });
    } else {
      checks.push({ type: 'industry', label, status: 'FAIL', detail: `供应商行业：${ind}`, required: true });
    }
  }

  // ── 资质（每字典项独立一条）：关键词包含命中 + 有效期 ──
  for (const req of c.qualifications || []) {
    const dict = QUALIFICATION_DICTIONARY.find((d) => d.key === req.key);
    if (!dict) continue;
    const kws = dict.keywords.map((k) => k.toLowerCase());
    const hits = s.qualifications.filter((q) => {
      const n = (q.name || '').toLowerCase();
      return kws.some((k) => n.includes(k));
    });
    const now = Date.now();
    const valid = hits.filter((q) => {
      if (!q.validTo) return true; // 空=长期有效
      const t = q.validTo instanceof Date ? q.validTo.getTime() : new Date(q.validTo).getTime();
      return Number.isFinite(t) && t > now;
    });
    if (hits.length === 0) {
      checks.push({ type: 'qualification', label: dict.label, status: 'MISSING', detail: '库内未见该资质记录，请人工核实', required: req.required });
    } else if (valid.length > 0) {
      checks.push({ type: 'qualification', label: dict.label, status: 'PASS', required: req.required });
    } else {
      checks.push({ type: 'qualification', label: dict.label, status: 'FAIL', detail: '证书已过期', required: req.required });
    }
  }

  // ── 业绩：年限窗（signDate 回退 createdAt）+ 关键词 + 数量 ──
  const p = c.performance;
  if (p && (p.years != null || p.minCount != null || (p.keywords && p.keywords.length > 0))) {
    const label = `业绩（${p.years ? `近${p.years}年` : ''}${p.minCount ? `≥${p.minCount}项` : ''}${
      p.keywords && p.keywords.length ? `，关键词：${p.keywords.join('、')}` : ''
    }）`;
    if (s.performances.length === 0) {
      checks.push({ type: 'performance', label, status: 'MISSING', detail: '库内暂无该供应商业绩记录', required: true });
    } else {
      const windowStart = p.years ? Date.now() - p.years * 365.25 * 24 * 3600 * 1000 : null;
      const kws = (p.keywords || []).map((k) => k.toLowerCase()).filter(Boolean);
      const matched = s.performances.filter((perf) => {
        const t = perf.signDate ? perf.signDate.getTime() : perf.createdAt.getTime();
        if (windowStart != null && t < windowStart) return false;
        if (kws.length > 0) {
          const text = `${perf.projectName || ''}${perf.description || ''}`.toLowerCase();
          if (!kws.some((k) => text.includes(k))) return false;
        }
        return true;
      });
      const ok = p.minCount != null ? matched.length >= p.minCount : matched.length > 0;
      checks.push({
        type: 'performance',
        label,
        status: ok ? 'PASS' : 'FAIL',
        detail: ok ? undefined : `符合条件的业绩 ${matched.length} 项（共 ${s.performances.length} 项记录）`,
        required: true,
      });
    }
  }

  // ── 评价等级：最新 finalGrade 序数比较（无记录=MISSING）──
  if (c.minGrade) {
    const label = `评价等级≥${c.minGrade}`;
    if (!latestGrade) {
      checks.push({ type: 'grade', label, status: 'MISSING', detail: '库内暂无评价记录', required: true });
    } else {
      const ok = (GRADE_SCORE[latestGrade] ?? 0) >= (GRADE_SCORE[c.minGrade] ?? 5);
      checks.push({
        type: 'grade',
        label,
        status: ok ? 'PASS' : 'FAIL',
        detail: ok ? undefined : `最新等级：${latestGrade}`,
        required: true,
      });
    }
  }

  return checks;
}

export function filterPoolByHardConditions(
  pool: HardConditionSupplierData[],
  c: HardConditions,
  latestGradeBySupplier?: Map<string, string | null>,
): {
  kept: HardConditionSupplierData[];
  filteredOut: { supplierId: string; name: string; failedCondition: string }[];
  checksBySupplier: Map<string, ConditionCheck[]>;
} {
  const kept: HardConditionSupplierData[] = [];
  const filteredOut: { supplierId: string; name: string; failedCondition: string }[] = [];
  const checksBySupplier = new Map<string, ConditionCheck[]>();
  for (const s of pool) {
    const checks = verifySupplierHardConditions(s, c, latestGradeBySupplier?.get(s.id) ?? null);
    checksBySupplier.set(s.id, checks);
    const failed = checks.find((ch) => ch.status === 'FAIL' && ch.required);
    if (failed) {
      filteredOut.push({ supplierId: s.id, name: s.name, failedCondition: failed.label + (failed.detail ? `（${failed.detail}）` : '') });
    } else {
      kept.push(s);
    }
  }
  return { kept, filteredOut, checksBySupplier };
}

/** controller 入参消毒：白名单字典 key、夹取数字、剔除垃圾 */
export function sanitizeHardConditions(raw: unknown): HardConditions {
  const out: HardConditions = {};
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.industries)) {
    // 只收字符串（数字等垃圾类型剔除——String(42)='42' 会混进词表）
    const v = r.industries.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 10);
    if (v.length > 0) out.industries = Array.from(new Set(v));
  }
  if (Array.isArray(r.qualifications)) {
    const dictKeys = new Set(QUALIFICATION_DICTIONARY.map((d) => d.key));
    const v = r.qualifications
      .filter((x) => x && typeof x === 'object' && dictKeys.has(String((x as Record<string, unknown>).key)))
      .map((x) => ({ key: String((x as Record<string, unknown>).key), required: (x as Record<string, unknown>).required !== false }))
      .slice(0, 8);
    if (v.length > 0) out.qualifications = v;
  }
  if (r.performance && typeof r.performance === 'object') {
    const p = r.performance as Record<string, unknown>;
    const perf: { years?: number; minCount?: number; keywords?: string[] } = {};
    if (Number.isFinite(Number(p.years))) perf.years = Math.min(Math.max(Math.round(Number(p.years)), 1), 10);
    if (Number.isFinite(Number(p.minCount))) perf.minCount = Math.min(Math.max(Math.round(Number(p.minCount)), 1), 99);
    if (Array.isArray(p.keywords)) {
      // 同 industries：只收字符串，数字等垃圾类型剔除
      const k = p.keywords.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 5);
      if (k.length > 0) perf.keywords = k;
    }
    if (Object.keys(perf).length > 0) out.performance = perf;
  }
  if (r.minGrade === 'A' || r.minGrade === 'B' || r.minGrade === 'C') out.minGrade = r.minGrade;
  return out;
}

/** LLM 预填输出白名单过滤——只能在词表/字典范围内取值，编造即剔除 */
export function sanitizeSuggestedHardConditions(
  raw: unknown,
  vocab: { industries: string[]; qualKeys: string[] },
): HardConditions {
  const base = sanitizeHardConditions(raw);
  const out: HardConditions = {};
  if (base.industries) {
    const set = new Set(vocab.industries);
    const v = base.industries.filter((i) => set.has(i));
    if (v.length > 0) out.industries = v;
  }
  if (base.qualifications) {
    const set = new Set(vocab.qualKeys);
    const v = base.qualifications.filter((q) => set.has(q.key));
    if (v.length > 0) out.qualifications = v;
  }
  if (base.performance) out.performance = base.performance;
  if (base.minGrade) out.minGrade = base.minGrade;
  return out;
}
