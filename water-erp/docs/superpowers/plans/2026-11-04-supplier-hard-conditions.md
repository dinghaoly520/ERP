# 供应商要求·硬性条件核验闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 供应商选取向导的「供应商要求」升级为「硬性筛选条件（库内词表+内置字典，机器三态核验）+ 五段软性文本」，推荐结果带逐项核验矩阵与被剔除名单，LLM 候选行补齐库内证据。

**Architecture:** 后端新增纯函数核验引擎（字典+三态判定+池过滤），接入 `POST /ai/supplier-selection` 检索阶段（FAIL 剔除、MISSING 保留）；新增词表端点与 AI 预填端点（仿 suggest-tags 先例）；LLM 排序候选行扩充证据字段。前端向导步骤 1 加硬性条件区（chips/数字输入），步骤 2 推荐卡加核验矩阵+剔除名单展开。

**Tech Stack:** NestJS 11 + Prisma（apps/api）、Next.js 16 + React 19（apps/web）、DeepSeek via LlmService、Jest 单测。

**Spec:** `docs/superpowers/specs/2026-11-04-supplier-requirement-hard-conditions-design.md`（含用户裁定，实现遇口径分歧以 spec 为准）

## Global Constraints

- 界面文案纯中文（格式名/键名除外）；无 mock 数据兜底——真实数据/加载/空态三选一。
- 新 UI 遵循 cgzxui 视觉体系（neumorphic 凸起边框、`workbench-input`、`neu-btn-xs`），参照同页 `BusinessTagsPicker` 的 chips 语言。
- `hardConditions` 全可空：不传时 `POST /ai/supplier-selection` 行为与现状逐字节一致（老调用零破坏）。
- 并行会话在制 tender-write 文件——**禁 `git add -A`/`git add .`，只 add 本计划列出的文件**；每任务一提交。
- API 侧 tsconfig 无 `esModuleInterop`；单测 co-located `*.spec.ts`，跑法 `pnpm --filter api test -- <pattern>`。
- 供应商域测试口径：改 `ai.service`/`supplier-selection-ai` 后跑 `pnpm --filter api test -- supplier`（窄 pattern 会漏跨 spec 破坏）。

---

### Task 1: 资质字典 + 三态核验引擎（纯函数）

**Files:**
- Create: `apps/api/src/ai/supplier-hard-conditions.ts`
- Test: `apps/api/src/ai/supplier-hard-conditions.spec.ts`

**Interfaces:**
- Produces（后续任务依赖的精确签名）:
  - `interface HardConditions { industries?: string[]; qualifications?: { key: string; required: boolean }[]; performance?: { years?: number; minCount?: number; keywords?: string[] }; minGrade?: 'A'|'B'|'C' }`
  - `interface ConditionCheck { type: 'industry'|'qualification'|'performance'|'grade'; label: string; status: 'PASS'|'FAIL'|'MISSING'; detail?: string; required: boolean }`
  - `interface HardConditionSupplierData { id: string; name: string; industry?: string | null; qualifications: { name: string; validTo?: Date | string | null }[]; performances: { projectName: string; description?: string | null; signDate?: Date | null; createdAt: Date }[] }`（结构类型，Prisma 行直接可传）
  - `QUALIFICATION_DICTIONARY: { key: string; label: string; category: string; keywords: string[] }[]`
  - `hardConditionsEmpty(c: HardConditions | undefined): boolean`
  - `verifySupplierHardConditions(s: HardConditionSupplierData, c: HardConditions): ConditionCheck[]`
  - `filterPoolByHardConditions(pool: HardConditionSupplierData[], c: HardConditions): { kept: HardConditionSupplierData[]; filteredOut: { supplierId: string; name: string; failedCondition: string }[]; checksBySupplier: Map<string, ConditionCheck[]> }`
  - `sanitizeHardConditions(raw: unknown): HardConditions`（controller 入参消毒）
  - `sanitizeSuggestedHardConditions(raw: unknown, vocab: { industries: string[]; qualKeys: string[] }): HardConditions`（Task 3 LLM 输出白名单过滤）

- [ ] **Step 1: 写失败测试**

```typescript
// apps/api/src/ai/supplier-hard-conditions.spec.ts
import {
  QUALIFICATION_DICTIONARY, hardConditionsEmpty, verifySupplierHardConditions,
  filterPoolByHardConditions, sanitizeHardConditions,
} from './supplier-hard-conditions';

const NOW = new Date('2026-11-04T00:00:00+08:00');

function mkSupplier(over: Partial<Parameters<typeof verifySupplierHardConditions>[0]> = {}) {
  return {
    id: 's1', name: '测试供应商', industry: '通用设备制造业',
    qualifications: [], performances: [],
    ...over,
  };
}

describe('资质字典', () => {
  it('key 唯一且 keywords 非空', () => {
    const keys = QUALIFICATION_DICTIONARY.map((q) => q.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const q of QUALIFICATION_DICTIONARY) expect(q.keywords.length).toBeGreaterThan(0);
  });
});

describe('hardConditionsEmpty', () => {
  it('空对象/undefined 为 true，任一维度有值为 false', () => {
    expect(hardConditionsEmpty(undefined)).toBe(true);
    expect(hardConditionsEmpty({})).toBe(true);
    expect(hardConditionsEmpty({ industries: ['批发业'] })).toBe(false);
    expect(hardConditionsEmpty({ performance: { minCount: 2 } })).toBe(false);
    expect(hardConditionsEmpty({ qualifications: [{ key: 'iso9001', required: true }] })).toBe(false);
    expect(hardConditionsEmpty({ minGrade: 'B' })).toBe(false);
    // 空壳子对象视为空
    expect(hardConditionsEmpty({ performance: {} })).toBe(true);
    expect(hardConditionsEmpty({ industries: [] })).toBe(true);
  });
});

describe('行业三态', () => {
  const cond = { industries: ['通用设备制造业', '批发业'] };
  it('命中=PASS', () => {
    const checks = verifySupplierHardConditions(mkSupplier(), cond);
    expect(checks[0].status).toBe('PASS');
    expect(checks[0].type).toBe('industry');
  });
  it('未命中=FAIL', () => {
    const checks = verifySupplierHardConditions(mkSupplier({ industry: '餐饮业' }), cond);
    expect(checks[0].status).toBe('FAIL');
    expect(checks[0].detail).toContain('餐饮业');
  });
  it('未填行业=MISSING', () => {
    const checks = verifySupplierHardConditions(mkSupplier({ industry: null }), cond);
    expect(checks[0].status).toBe('MISSING');
  });
});

describe('资质三态（关键词变体匹配）', () => {
  const cond = { qualifications: [{ key: 'iso9001', required: true }] };
  it('变体命中且有效=PASS（iso9001/ISO 9001/质量管理体系认证）', () => {
    for (const name of ['ISO9001质量管理体系认证', 'ISO 9001:2015认证', '质量管理体系认证证书']) {
      const checks = verifySupplierHardConditions(
        mkSupplier({ qualifications: [{ name, validTo: null }] }), cond);
      expect(checks[0].status).toBe(name === '质量管理体系认证证书' ? 'PASS' : 'PASS');
    }
  });
  it('命中但全部过期=FAIL', () => {
    const checks = verifySupplierHardConditions(
      mkSupplier({ qualifications: [{ name: 'ISO9001认证', validTo: new Date('2020-01-01') }] }), cond);
    expect(checks[0].status).toBe('FAIL');
    expect(checks[0].detail).toContain('过期');
  });
  it('无命中=MISSING（长串自由文本不含关键词）', () => {
    const checks = verifySupplierHardConditions(
      mkSupplier({ qualifications: [{ name: '持证等级: 工程勘察（综合）甲级', validTo: null }] }), cond);
    expect(checks[0].status).toBe('MISSING');
  });
  it('优先级不改变核验状态', () => {
    const checks = verifySupplierHardConditions(
      mkSupplier(), { qualifications: [{ key: 'iso9001', required: false }] });
    expect(checks[0].status).toBe('MISSING');
    expect(checks[0].required).toBe(false);
  });
});

describe('业绩三态', () => {
  const perf = (name: string, signDate: Date) => ({ projectName: name, description: null, signDate, createdAt: signDate });
  it('年限窗内数量达标=PASS', () => {
    const s = mkSupplier({ performances: [perf('钻机采购', new Date('2025-06-01')), perf('钻具供货', new Date('2026-01-01'))] });
    const checks = verifySupplierHardConditions(s, { performance: { years: 3, minCount: 2, keywords: ['钻'] } });
    expect(checks[0].status).toBe('PASS');
  });
  it('有记录但数量不足=FAIL', () => {
    const s = mkSupplier({ performances: [perf('办公家具', new Date('2026-01-01'))] });
    const checks = verifySupplierHardConditions(s, { performance: { minCount: 2 } });
    expect(checks[0].status).toBe('FAIL');
  });
  it('记录在窗外不计入（FAIL）', () => {
    const s = mkSupplier({ performances: [perf('钻机', new Date('2020-01-01'))] });
    const checks = verifySupplierHardConditions(s, { performance: { years: 3, minCount: 1 } });
    expect(checks[0].status).toBe('FAIL');
  });
  it('零记录=MISSING（库内数据空白期常态）', () => {
    const checks = verifySupplierHardConditions(mkSupplier(), { performance: { minCount: 1 } });
    expect(checks[0].status).toBe('MISSING');
  });
  it('minCount 未设但有记录=PASS', () => {
    const s = mkSupplier({ performances: [perf('任意', new Date('2026-01-01'))] });
    const checks = verifySupplierHardConditions(s, { performance: {} });
    expect(checks[0].status).toBe('PASS');
  });
});

describe('评价等级三态', () => {
  it('阈值比较与无记录', () => {
    expect(verifySupplierHardConditions(mkSupplier(), { minGrade: 'B' })[0].status).toBe('MISSING');
    expect(verifySupplierHardConditions(mkSupplier(), { minGrade: 'A' })[0].status).toBe('MISSING');
  });
});

describe('filterPoolByHardConditions', () => {
  it('必须级 FAIL 剔除进 filteredOut，MISSING 保留，checks 记录保留者', () => {
    const pool = [
      mkSupplier({ id: 'a', name: '甲', industry: '通用设备制造业' }),
      mkSupplier({ id: 'b', name: '乙', industry: '餐饮业' }),           // 行业 FAIL → 剔除
      mkSupplier({ id: 'c', name: '丙', industry: null }),               // 行业 MISSING → 保留
    ];
    const r = filterPoolByHardConditions(pool, { industries: ['通用设备制造业'] });
    expect(r.kept.map((s) => s.id)).toEqual(['a', 'c']);
    expect(r.filteredOut).toEqual([{ supplierId: 'b', name: '乙', failedCondition: expect.stringContaining('行业') }]);
    expect(r.checksBySupplier.get('a')![0].status).toBe('PASS');
    expect(r.checksBySupplier.get('c')![0].status).toBe('MISSING');
  });
  it('优先级资质 FAIL 不剔除', () => {
    const pool = [mkSupplier({ id: 'a', qualifications: [] })];
    const r = filterPoolByHardConditions(pool, { qualifications: [{ key: 'iso9001', required: false }] });
    expect(r.kept).toHaveLength(1);
    expect(r.filteredOut).toHaveLength(0);
  });
  it('空条件原样放行', () => {
    const pool = [mkSupplier()];
    expect(filterPoolByHardConditions(pool, {}).kept).toHaveLength(1);
  });
});

describe('sanitizeHardConditions', () => {
  it('消毒：非法 key 剔除、数字夹取、类型矫正', () => {
    const out = sanitizeHardConditions({
      industries: ['批发业', 42, ''],
      qualifications: [{ key: 'iso9001', required: 'yes' }, { key: '不存在的key', required: true }],
      performance: { years: 99, minCount: -3, keywords: ['钻机', 7] },
      minGrade: 'D',
    });
    expect(out.industries).toEqual(['批发业']);
    expect(out.qualifications).toEqual([{ key: 'iso9001', required: true }]);
    expect(out.performance).toEqual({ years: 10, minCount: 1, keywords: ['钻机'] });
    expect(out.minGrade).toBeUndefined();
  });
  it('垃圾输入返回空对象', () => {
    expect(sanitizeHardConditions('nonsense')).toEqual({});
    expect(sanitizeHardConditions(null)).toEqual({});
  });
});
```

注意：`verifySupplierHardConditions` 内部判定「现在」须可注入以便测试——实现加可选第二参 `now: Date = new Date()` 放在 `HardConditions` 之后？不——签名定为 `verifySupplierHardConditions(s, c, now: Date = new Date())`；上面测试里窗口用相对近期日期构造（2025/2026 相对真实 today 仍在 3 年窗内），`validTo` 过期例用 2020 硬编码，均不依赖注入。但为防 2029 年跑测试窗漂移，业绩「窗内」用例的 `signDate` 用 `new Date(Date.now() - 1000*60*60*24*30)`（30 天前）替代固定日期。**测试代码以本注记为准修正后写入。**

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx jest src/ai/supplier-hard-conditions.spec.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```typescript
// apps/api/src/ai/supplier-hard-conditions.ts
/*
 * 供应商硬性筛选条件——资质字典 + 三态核验引擎（纯函数，无 IO）。
 * 三态语义（2026-11-04 用户裁定）：PASS=满足 / FAIL=不满足（必须级剔除）/ MISSING=资料缺失（保留标黄）。
 * 词表口径：行业=库内 Supplier.industry 聚合；资质=本文件内置字典（加项=改代码，勿建 DB 表）。
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
  if (c.performance && (c.performance.years != null || c.performance.minCount != null
    || (c.performance.keywords && c.performance.keywords.length > 0))) return false;
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
    const ind = (s.industry || '').trim();
    if (!ind) {
      checks.push({ type: 'industry', label: `行业（${c.industries.join('、')}）`, status: 'MISSING', detail: '库内未见该供应商行业资料', required: true });
    } else if (c.industries.includes(ind)) {
      checks.push({ type: 'industry', label: `行业（${c.industries.join('、')}）`, status: 'PASS', required: true });
    } else {
      checks.push({ type: 'industry', label: `行业（${c.industries.join('、')}）`, status: 'FAIL', detail: `供应商行业：${ind}`, required: true });
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
    const label = `业绩（${p.years ? `近${p.years}年` : ''}${p.minCount ? `≥${p.minCount}项` : ''}${p.keywords && p.keywords.length ? `，关键词：${p.keywords.join('、')}` : ''}）`;
    if (s.performances.length === 0) {
      checks.push({ type: 'performance', label, status: 'MISSING', detail: '库内暂无该供应商业绩记录', required: true });
    } else {
      const windowStart = p.years ? Date.now() - p.years * 365.25 * 24 * 3600 * 1000 : null;
      const kws = (p.keywords || []).map((k) => k.toLowerCase()).filter(Boolean);
      const matched = s.performances.filter((perf) => {
        const t = (perf.signDate ? perf.signDate.getTime() : perf.createdAt.getTime());
        if (windowStart && t < windowStart) return false;
        if (kws.length > 0) {
          const text = `${perf.projectName || ''}${perf.description || ''}`.toLowerCase();
          if (!kws.some((k) => text.includes(k))) return false;
        }
        return true;
      });
      const ok = p.minCount != null ? matched.length >= p.minCount : matched.length > 0;
      checks.push({ type: 'performance', label, status: ok ? 'PASS' : 'FAIL',
        detail: ok ? undefined : `符合条件的业绩 ${matched.length} 项（共 ${s.performances.length} 项记录）`, required: true });
    }
  }

  // ── 评价等级：最新 finalGrade 序数比较（无记录=MISSING）──
  if (c.minGrade) {
    const label = `评价等级≥${c.minGrade}`;
    if (!latestGrade) {
      checks.push({ type: 'grade', label, status: 'MISSING', detail: '库内暂无评价记录', required: true });
    } else {
      const ok = (GRADE_SCORE[latestGrade] ?? 0) >= (GRADE_SCORE[c.minGrade] ?? 5);
      checks.push({ type: 'grade', label, status: ok ? 'PASS' : 'FAIL', detail: ok ? undefined : `最新等级：${latestGrade}`, required: true });
    }
  }

  return checks;
}

export function filterPoolByHardConditions(
  pool: HardConditionSupplierData[],
  c: HardConditions,
  latestGradeBySupplier?: Map<string, string | null>,
): { kept: HardConditionSupplierData[]; filteredOut: { supplierId: string; name: string; failedCondition: string }[]; checksBySupplier: Map<string, ConditionCheck[]> } {
  const kept: HardConditionSupplierData[] = [];
  const filteredOut: { supplierId: string; name: string; failedCondition: string }[] = [];
  const checksBySupplier = new Map<string, ConditionCheck[]>();
  for (const s of pool) {
    const checks = verifySupplierHardConditions(s, c, latestGradeBySupplier?.get(s.id) ?? null);
    checksBySupplier.set(s.id, checks);
    const failed = checks.find((ch) => ch.status === 'FAIL' && ch.required);
    if (failed) filteredOut.push({ supplierId: s.id, name: s.name, failedCondition: failed.label + (failed.detail ? `（${failed.detail}）` : '') });
    else kept.push(s);
  }
  return { kept, filteredOut, checksBySupplier };
}

/** controller 入参消毒：白名单字典 key、夹取数字、剔除垃圾 */
export function sanitizeHardConditions(raw: unknown): HardConditions {
  const out: HardConditions = {};
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.industries)) {
    const v = r.industries.map((x) => String(x).trim()).filter(Boolean).slice(0, 10);
    if (v.length > 0) out.industries = Array.from(new Set(v));
  }
  if (Array.isArray(r.qualifications)) {
    const dictKeys = new Set(QUALIFICATION_DICTIONARY.map((d) => d.key));
    const v = r.qualifications
      .filter((x) => x && typeof x === 'object' && dictKeys.has(String((x as any).key)))
      .map((x) => ({ key: String((x as any).key), required: (x as any).required !== false }))
      .slice(0, 8);
    if (v.length > 0) out.qualifications = v;
  }
  if (r.performance && typeof r.performance === 'object') {
    const p = r.performance as Record<string, unknown>;
    const perf: { years?: number; minCount?: number; keywords?: string[] } = {};
    if (Number.isFinite(Number(p.years))) perf.years = Math.min(Math.max(Math.round(Number(p.years)), 1), 10);
    if (Number.isFinite(Number(p.minCount))) perf.minCount = Math.min(Math.max(Math.round(Number(p.minCount)), 1), 99);
    if (Array.isArray(p.keywords)) {
      const k = p.keywords.map((x) => String(x).trim()).filter(Boolean).slice(0, 5);
      if (k.length > 0) perf.keywords = k;
    }
    if (Object.keys(perf).length > 0) out.performance = perf;
  }
  if (r.minGrade === 'A' || r.minGrade === 'B' || r.minGrade === 'C') out.minGrade = r.minGrade;
  return out;
}

/** LLM 预填输出白名单过滤（Task 3 用）——只能在词表/字典范围内取值 */
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
```

（评价等级核验需要「最新评价等级」入参——`verifySupplierHardConditions` 第三参 `latestGrade`，`filterPoolByHardConditions` 第三参 `latestGradeBySupplier: Map`。测试里 grade 用例不传即为无记录 MISSING。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/api && npx jest src/ai/supplier-hard-conditions.spec.ts`
Expected: PASS 全绿

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/ai/supplier-hard-conditions.ts apps/api/src/ai/supplier-hard-conditions.spec.ts
git commit -m "feat(ai): 供应商硬性筛选条件——资质字典+三态核验引擎（纯函数）"
```

---

### Task 2: recommendSuppliers 集成核验（检索阶段过滤 + 响应契约）

**Files:**
- Modify: `apps/api/src/ai/ai.types.ts`（`SupplierSelectionResult` 扩展）
- Modify: `apps/api/src/ai/ai.controller.ts:96-122`（body 解析 `hardConditions`）
- Modify: `apps/api/src/ai/ai.service.ts:1211-1400`（`recommendSuppliers`）

**Interfaces:**
- Consumes: Task 1 全部导出。
- Produces: `SupplierSelectionResult` 新增 `conditionsCheck?: { supplierId: string; checks: ConditionCheck[] }[]`、`filteredOut?: { supplierId: string; name: string; failedCondition: string }[]`；`recommendSuppliers` opts 新增 `hardConditions?: HardConditions`（`ConditionCheck`/`HardConditions` 从 `./supplier-hard-conditions` re-export 到 ai.types.ts 供前端契约注释）。

- [ ] **Step 1: 扩展类型**

`apps/api/src/ai/ai.types.ts` 顶部加：

```typescript
import { HardConditions, ConditionCheck } from './supplier-hard-conditions';
export type { HardConditions, ConditionCheck };
```

`SupplierSelectionResult`（`ai.types.ts:72`）在 `generatedAt` 前加：

```typescript
  /** 硬性条件逐项核验（仅传入 hardConditions 时返回；键=推荐供应商） */
  conditionsCheck?: { supplierId: string; checks: ConditionCheck[] }[];
  /** 被硬性条件剔除的供应商（必须级 FAIL；供人工复核误杀） */
  filteredOut?: { supplierId: string; name: string; failedCondition: string }[];
```

- [ ] **Step 2: controller 解析消毒**

`ai.controller.ts` supplier-selection 端点 body 类型加 `hardConditions?: unknown`，调用处加一行：

```typescript
hardConditions: sanitizeHardConditions(body?.hardConditions),
```

（顶部 `import { sanitizeHardConditions } from './supplier-hard-conditions';`；`hardConditionsEmpty` 判断在 service 内做——空对象时行为与现状一致。）

- [ ] **Step 3: service 检索阶段接入**

`ai.service.ts` `recommendSuppliers`：

1. opts 类型加 `hardConditions?: HardConditions`（import 自 `./supplier-hard-conditions`）。
2. 候选池查询（`:1236` 附近）include 扩充：

```typescript
      include: {
        contacts: { orderBy: { isPrimary: 'desc' }, take: 10 },
        qualifications: { select: { name: true, validTo: true }, take: 20 },
        performances: { where: { recordType: 'performance' }, select: { projectName: true, description: true, signDate: true, createdAt: true }, orderBy: { signDate: 'desc' }, take: 50 },
        penalties: { select: { id: true } },
        evaluations: { select: { finalGrade: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        bidSuppliers: { where: { project: { stage: { notIn: ['ARCHIVED'] } } }, select: { id: true } },
      },
```

注意：现状 `evaluations: { select: { finalGrade: true } }` 无 orderBy（evals[0] 取「最新」依赖默认排序）——加 `orderBy: { createdAt: 'desc' }, take: 1` 后 `evals[0]` 语义从「默认序第一条」变为真最新，`evalMap` 的 `count` 改用整表计数另查或保留 `evaluations: { select: { finalGrade: true, createdAt: true } }` 全取后前端逻辑不变。**取后者**（全取+前端已有取第一条逻辑），仅追加 createdAt：

```typescript
        evaluations: { select: { finalGrade: true, createdAt: true } },
```

`evalMap` 构建处（`:1338`）改为取 createdAt 最大者（防御顺序不稳）：

```typescript
      if (evals.length > 0) {
        const latest = evals.reduce((a, b) => ((a as any).createdAt >= (b as any).createdAt ? a : b));
        evalMap.set(s.id, { level: latest.finalGrade || '', count: evals.length });
      }
```

3. 查询返回后、n-gram 评分前插入硬性过滤（`suppliers` 数组级）：

```typescript
    // 硬性条件三态核验（2026-11-04 spec）：必须级 FAIL 剔除、MISSING 保留；不传=零行为变化
    let hardChecks = new Map<string, ConditionCheck[]>();
    let hardFilteredOut: { supplierId: string; name: string; failedCondition: string }[] | undefined;
    if (!hardConditionsEmpty(opts.hardConditions)) {
      const latestGrade = new Map<string, string | null>();
      for (const s of suppliers) {
        const evs: { finalGrade: string; createdAt: Date }[] = (s as any).evaluations || [];
        latestGrade.set(s.id, evs.length > 0 ? evs.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b)).finalGrade : null);
      }
      const verdict = filterPoolByHardConditions(suppliers as any, opts.hardConditions!, latestGrade);
      const keptIds = new Set(verdict.kept.map((k) => k.id));
      suppliers = suppliers.filter((s) => keptIds.has(s.id));
      hardChecks = verdict.checksBySupplier;
      hardFilteredOut = verdict.filteredOut;
      if (suppliers.length === 0) {
        return {
          requirement, engine: 'rules', model: '', candidatePool: 0,
          summary: `硬性筛选条件剔除了全部 ${verdict.filteredOut.length} 家候选供应商，请放宽条件后重试。`,
          recommendations: [], generatedAt: new Date().toISOString(),
          conditionsCheck: [], filteredOut: hardFilteredOut,
        };
      }
    }
```

（`filterPoolByHardConditions(suppliers as any, ...)` 结构类型兼容：prisma 行含 extra 字段不冲突；qualifications含多余字段 type/fileUrl 等也不冲突——HardConditionSupplierData 是宽松结构类型。）

4. 返回对象（方法末尾 `return { requirement, engine, ... }` 处）追加：

```typescript
      ...(hardFilteredOut ? {
        conditionsCheck: recommendations.map((r) => ({ supplierId: r.supplierId, checks: hardChecks.get(r.supplierId) ?? [] })),
        filteredOut: hardFilteredOut,
      } : {}),
```

5. `rankCandidates` 两处调用（`:1369,1373`）追加第二……不——checks 传参属 Task 4（SelectionCandidate 扩展一起做）。本任务不动 rankCandidates。

- [ ] **Step 4: 验证**

Run: `cd apps/api && npx tsc --noEmit && npx jest src/ai/supplier-hard-conditions.spec.ts`
Expected: tsc 干净 + Task 1 测试仍绿。再跑 `npx jest src/ai`（ai 域既有 spec 不破坏）。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/ai/ai.types.ts apps/api/src/ai/ai.controller.ts apps/api/src/ai/ai.service.ts
git commit -m "feat(ai): supplier-selection 接入硬性条件核验——FAIL 剔除/MISSING 保留+filteredOut 返回"
```

---

### Task 3: 词表端点 + AI 预填端点

**Files:**
- Modify: `apps/api/src/ai/ai.controller.ts`（两个新端点）
- Modify: `apps/api/src/ai/ai.service.ts`（`getHardConditionVocab` + `suggestHardConditions`）
- Test: `apps/api/src/ai/supplier-hard-conditions.spec.ts`（追加 sanitizeSuggestedHardConditions 用例）

**Interfaces:**
- Consumes: Task 1 `QUALIFICATION_DICTIONARY`/`sanitizeSuggestedHardConditions`；既有 `supplierCompanyWhere(await this.companyScope.resolveScope(actor, companyId))` 模式（ai.service 已注入 companyScope）；既有 `suggestBusinessTags`（`ai.service.ts:72`）的 LLM 词表选择范式。
- Produces:
  - `GET /ai/hard-condition-vocab?companyId=` → `{ industries: { name: string; count: number }[]; qualifications: { key: string; label: string; category: string }[] }`（行业=登录人公司视野 APPROVED 聚合）
  - `POST /ai/suggest-hard-conditions` body `{ projectContext?: Record<string, string>; industries?: string[]; qualifications?: { key: string; label: string }[] }` → `{ hardConditions: HardConditions }`

- [ ] **Step 1: 追加失败测试**

`supplier-hard-conditions.spec.ts` 追加：

```typescript
import { sanitizeSuggestedHardConditions } from './supplier-hard-conditions';

describe('sanitizeSuggestedHardConditions（LLM 预填白名单）', () => {
  const vocab = { industries: ['通用设备制造业', '批发业'], qualKeys: ['iso9001', 'hightech'] };
  it('词表内保留、词表外剔除', () => {
    const out = sanitizeSuggestedHardConditions({
      industries: ['批发业', '餐饮业'],
      qualifications: [{ key: 'iso9001', required: true }, { key: 'iso45001', required: false }],
      minGrade: 'B',
    }, vocab);
    expect(out).toEqual({ industries: ['批发业'], qualifications: [{ key: 'iso9001', required: true }], minGrade: 'B' });
  });
  it('LLM 编造的垃圾全滤后返回空对象', () => {
    expect(sanitizeSuggestedHardConditions({ industries: ['不存在行业'] }, vocab)).toEqual({});
  });
});
```

Run: `cd apps/api && npx jest src/ai/supplier-hard-conditions.spec.ts` → 新用例 FAIL（函数已有实现应直接绿；若 Step 写于 Task 1 之后此处直接 PASS 也算数——跳过红步，保留断言价值）。

- [ ] **Step 2: service 实现**

`ai.service.ts` 追加两个方法（放在 `suggestBusinessTags` 后）：

```typescript
  /** 硬性条件词表：行业=库内公司视野聚合；资质=内置字典（2026-11-04 spec） */
  async getHardConditionVocab(actor: AuthenticatedUser, companyId?: string) {
    const where: Prisma.SupplierWhereInput = {
      status: 'APPROVED',
      ...supplierCompanyWhere(await this.companyScope.resolveScope(actor, companyId)),
    };
    const rows = await this.prisma.supplier.groupBy({
      by: ['industry'], where, _count: { _all: true },
    });
    const industries = rows
      .map((r) => ({ name: (r.industry || '').trim() || '未填写', count: r._count._all }))
      .filter((r) => r.name !== '未填写')
      .sort((a, b) => b.count - a.count);
    return {
      industries,
      qualifications: QUALIFICATION_DICTIONARY.map(({ key, label, category }) => ({ key, label, category })),
    };
  }

  /** AI 预填硬性条件——只能从词表/字典选，选不出留空（仿 suggestBusinessTags 范式） */
  async suggestHardConditions(input: {
    projectContext?: Record<string, string>;
    industries: string[];
    qualifications: { key: string; label: string }[];
  }): Promise<HardConditions> {
    const industries = Array.from(new Set(input.industries || []));
    const quals = (input.qualifications || []).filter((q) => q && q.key && q.label).slice(0, 60);
    if (industries.length === 0 && quals.length === 0) return {};

    const system = [
      '你是采购供应商筛选条件助手。根据采购项目背景，从给定词表中严格挑选硬性筛选条件。',
      '规则：',
      '1. 行业只能从「行业词表」选择 1-3 个与标的物制造/供应直接相关的行业；宁缺毋滥，判断不准就不选。',
      '2. 资质只能从「资质字典」选择项目确实要求的企业资质/体系认证（0-4 项），并判定 required：法定或采购文件明确的准入门槛建 true；锦上添花的加分项填 false。判断不准一律不选。',
      '3. 业绩：仅当项目文件明确写了业绩门槛（几年几项什么类型）才填 years/minCount/keywords；keywords 用 1-2 个核心产品词。没写就整个 performance 留空。',
      '4. minGrade：仅当背景明确要求历史评价等级时填，否则留空。',
      '5. 严禁自造词表外的行业名/资质名。仅输出严格 JSON，格式：',
      '{"industries":["..."],"qualifications":[{"key":"iso9001","required":true}],"performance":{"years":3,"minCount":2,"keywords":["钻机"]},"minGrade":"B"}',
      '不需要的维度留空数组或省略键。',
    ].join('\n');

    try {
      const res = await this.llm.chatJson<Record<string, unknown>>(system, JSON.stringify({
        projectContext: input.projectContext || {},
        行业词表: industries,
        资质字典: quals,
      }), 0);
      return sanitizeSuggestedHardConditions(res, { industries, qualKeys: quals.map((q) => q.key) });
    } catch {
      return {};
    }
  }
```

（import 追加：`HardConditions, QUALIFICATION_DICTIONARY, sanitizeSuggestedHardConditions`。`Prisma`/`supplierCompanyWhere` 已在文件既有 import 中——若缺按现状补。）

- [ ] **Step 3: controller 端点**

`ai.controller.ts` 追加（roles 对齐 supplier-selection）：

```typescript
  @Get('hard-condition-vocab')
  @ApiOperation({ summary: '硬性条件词表（行业=库内公司视野聚合 + 资质字典）' })
  @Roles('admin', 'bid_expert', 'bid_host', 'leader', 'staff')
  async getHardConditionVocab(@Query('companyId') companyId?: string, @Request() req: any = {}) {
    return this.aiService.getHardConditionVocab(req.user, companyId);
  }

  @Post('suggest-hard-conditions')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'AI 按项目上下文从词表预填硬性筛选条件' })
  @Roles('admin', 'bid_expert', 'bid_host', 'leader', 'staff')
  async suggestHardConditions(
    @Body() body: { projectContext?: Record<string, string>; industries?: string[]; qualifications?: { key: string; label: string }[] },
  ) {
    const industries = Array.isArray(body?.industries) ? body.industries.map((s) => String(s).trim()).filter(Boolean).slice(0, 40) : [];
    const qualifications = Array.isArray(body?.qualifications)
      ? body.qualifications.filter((q) => q && typeof q === 'object').map((q) => ({ key: String(q.key), label: String(q.label) })).slice(0, 60)
      : [];
    const hardConditions = await this.aiService.suggestHardConditions({
      projectContext: body?.projectContext, industries, qualifications,
    });
    return { hardConditions };
  }
```

- [ ] **Step 4: 验证**

Run: `cd apps/api && npx tsc --noEmit && npx jest src/ai/supplier-hard-conditions.spec.ts`
Expected: 干净+全绿

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/ai/ai.controller.ts apps/api/src/ai/ai.service.ts apps/api/src/ai/supplier-hard-conditions.spec.ts
git commit -m "feat(ai): 硬性条件词表端点 + AI 预填端点（词表白名单，杜绝编造）"
```

---

### Task 4: LLM 候选行证据增强

**Files:**
- Modify: `apps/api/src/ai/supplier-selection-ai.service.ts`
- Modify: `apps/api/src/ai/ai.service.ts`（candidates 映射 + rankCandidates 传 checks）
- Test: `apps/api/src/ai/supplier-selection-ai.spec.ts`（新建）

**Interfaces:**
- Consumes: Task 1 `ConditionCheck`；Task 2 `checksBySupplier`（recommendSuppliers 内变量）。
- Produces: `SelectionCandidate` 扩展字段 `industry?: string; qualificationNames?: string[]; performanceSummary?: string; penaltyCount?: number; registeredCapital?: string`；`rankCandidates(requirement, candidates, maxCount, projectContext?, checksBySupplier?: Map<string, ConditionCheck[]>)`；导出纯函数 `buildCandidateLines(candidates: SelectionCandidate[]): { lines: string[]; indexToId: Map<string, string> }`。

- [ ] **Step 1: 写失败测试**

```typescript
// apps/api/src/ai/supplier-selection-ai.spec.ts
import { buildCandidateLines, SelectionCandidate } from './supplier-selection-ai.service';

describe('buildCandidateLines（候选行证据组装）', () => {
  const c: SelectionCandidate = {
    id: 's1', name: '甲公司', businessScope: '钻机生产',
    industry: '通用设备制造业',
    qualificationNames: ['ISO9001质量管理体系认证', '高新技术企业证书'],
    performanceSummary: '近3年业绩2项（钻机采购、钻具供货）',
    penaltyCount: 0, registeredCapital: '1000万元',
    tags: ['钻探设备'], evalAvgScore: 4.5, evalLevel: 'A', evalCount: 2, activeProjects: 1,
  };
  it('行内含行业/资质全名/业绩摘要/注册资本/核验标记', () => {
    const { lines, indexToId } = buildCandidateLines([c]);
    expect(lines[0]).toContain('行业:通用设备制造业');
    expect(lines[0]).toContain('资质全:ISO9001质量管理体系认证、高新技术企业证书');
    expect(lines[0]).toContain('业绩:近3年业绩2项（钻机采购、钻具供货）');
    expect(lines[0]).toContain('注册资本:1000万元');
    expect(indexToId.get('c0')).toBe('s1');
  });
  it('业绩缺失明示「库内无业绩记录」，不虚构', () => {
    const { lines } = buildCandidateLines([{ ...c, performanceSummary: undefined }]);
    expect(lines[0]).toContain('业绩:库内无业绩记录');
  });
  it('核验标记：PASS✓/MISSING○/FAIL✗ 附加到行尾', () => {
    const checks = new Map<string, any[]>(['s1', [
      { type: 'industry', label: '行业（批发业）', status: 'PASS', required: true },
      { type: 'qualification', label: 'ISO9001 质量管理体系认证', status: 'MISSING', required: true },
    ]]);
    const { lines } = buildCandidateLines([c], checks);
    expect(lines[0]).toContain('核验:行业（批发业）✓ ISO9001 质量管理体系认证○');
  });
});
```

Run: `cd apps/api && npx jest src/ai/supplier-selection-ai.spec.ts` → FAIL

- [ ] **Step 2: 实现**

`supplier-selection-ai.service.ts`：

1. `SelectionCandidate` 追加字段：

```typescript
  // ── 库内证据（2026-11-04 spec）：让排序基于真实资料而非截断摘要 ──
  industry?: string;
  qualificationNames?: string[];   // 资质全名 top8（替代 60 字截断）
  performanceSummary?: string;     // 如「近3年业绩2项（钻机采购、钻具供货）」；无记录=undefined（渲染层明示）
  penaltyCount?: number;           // 惩戒记录条数
  registeredCapital?: string;
```

2. 行组装抽为导出纯函数（替换 `rankCandidates` 内 `lines = candidates.map(...)` 段）：

```typescript
export function buildCandidateLines(
  candidates: SelectionCandidate[],
  checksBySupplier?: Map<string, import('./supplier-hard-conditions').ConditionCheck[]>,
): { lines: string[]; indexToId: Map<string, string> } {
  const indexToId = new Map<string, string>();
  const lines = candidates.map((c, i) => {
    const key = `c${i}`;
    indexToId.set(key, c.id);
    const checks = checksBySupplier?.get(c.id);
    const checkMark = checks && checks.length > 0
      ? ` 核验:${checks.map((ch) => `${ch.label}${ch.status === 'PASS' ? '✓' : ch.status === 'MISSING' ? '○' : '✗'}`).join(' ')}`
      : '';
    return [
      key,
      c.name,
      c.industry ? `行业:${c.industry}` : '',
      c.classification ? `[${c.classification}]` : '',
      c.enterpriseType || '',
      (c.businessScope || '').slice(0, 90),
      c.tags && c.tags.length > 0 ? `标签:${c.tags.slice(0, 6).join('、')}` : '',
      c.qualificationNames && c.qualificationNames.length > 0 ? `资质全:${c.qualificationNames.slice(0, 8).join('、')}` : '资质:库内未见',
      `业绩:${c.performanceSummary || '库内无业绩记录'}`,
      c.penaltyCount ? `惩戒:${c.penaltyCount}条` : '',
      c.registeredCapital ? `注册资本:${c.registeredCapital}` : '',
      c.evalAvgScore != null ? `历史均分:${c.evalAvgScore}/${c.evalLevel || '-'}(${c.evalCount || 0}次)` : '历史评价:无',
      `在建项目:${c.activeProjects ?? 0}`,
    ].filter(Boolean).join(' | ') + checkMark;
  });
  return { lines, indexToId };
}
```

3. `rankCandidates` 签名加第五参 `checksBySupplier?: Map<string, ConditionCheck[]>`，内部 `const { lines, indexToId } = buildCandidateLines(candidates, checksBySupplier);`（原 indexToId/lines 构造段删除）。

4. system prompt 数组（`:84-92`）在「严格基于候选清单」一句前插入两行：

```typescript
      '候选清单含「行业/资质全/业绩/惩戒/注册资本/核验标记」证据：✓=已核验满足、○=库内资料缺失（不得据此扣分也不得虚构）、✗=不满足。资料完备且核验✓多者优先；「业绩:库内无业绩记录」者不得虚构其口碑。',
```

`ai.service.ts`：

5. candidates 映射（`:1352` 附近）追加证据字段：

```typescript
      industry: s.industry || undefined,
      qualificationNames: ((s.qualifications || []) as { name: string }[]).map((q) => q.name).slice(0, 8),
      performanceSummary: ((s as any).performances || []).length > 0
        ? `近3年业绩${(s as any).performances.length}项（${(s as any).performances.slice(0, 2).map((p: any) => p.projectName).filter(Boolean).join('、')}）`
        : undefined,
      penaltyCount: ((s as any).penalties || []).length,
      registeredCapital: s.registeredCapital || undefined,
```

（`近3年` 为话术简写——performances 已按 signDate desc 取 50 条，摘要口径「近期业绩 N 项」即可，不精确计算 3 年窗，LLM 语义参照用。）改为 `` `近期业绩${...}项（...）` `` 避免虚假精确。

6. 两处 `rankCandidates(...)` 调用追加第五参 `hardChecks`（Task 2 的变量；未启用硬条件时为空 Map——传 `hardChecks.size > 0 ? hardChecks : undefined`）。

- [ ] **Step 3: 跑测试**

Run: `cd apps/api && npx jest src/ai/supplier-selection-ai.spec.ts src/ai/supplier-hard-conditions.spec.ts && npx tsc --noEmit`
Expected: 全绿

- [ ] **Step 4: 提交**

```bash
git add apps/api/src/ai/supplier-selection-ai.service.ts apps/api/src/ai/supplier-selection-ai.spec.ts apps/api/src/ai/ai.service.ts
git commit -m "feat(ai): LLM 候选行证据增强——行业/资质全名/业绩摘要/惩戒/核验标记"
```

---

### Task 5: 前端 API 层（类型 + 三函数）

**Files:**
- Modify: `apps/web/src/lib/api/supplier.ts`

**Interfaces:**
- Consumes: 后端 Task 2/3 契约。
- Produces: `HardConditions`/`ConditionCheckDto` 类型、`SupplierSelectionResult` 扩展、`recommendSuppliers` 加 `hardConditions?: HardConditions`、`suggestHardConditions(data)`、`getHardConditionVocab(companyId?)`。

- [ ] **Step 1: 类型与函数**

`apps/web/src/lib/api/supplier.ts`（`SupplierSelectionResult` 定义 `:66` 处）：

```typescript
export interface HardConditions {
  industries?: string[];
  qualifications?: { key: string; required: boolean }[];
  performance?: { years?: number; minCount?: number; keywords?: string[] };
  minGrade?: 'A' | 'B' | 'C';
}

export interface ConditionCheckDto {
  type: 'industry' | 'qualification' | 'performance' | 'grade';
  label: string;
  status: 'PASS' | 'FAIL' | 'MISSING';
  detail?: string;
  required: boolean;
}

export interface HardConditionVocab {
  industries: { name: string; count: number }[];
  qualifications: { key: string; label: string; category: string }[];
}
```

`SupplierSelectionResult` 追加（`recommendations` 后）：

```typescript
  conditionsCheck?: { supplierId: string; checks: ConditionCheckDto[] }[];
  filteredOut?: { supplierId: string; name: string; failedCondition: string }[];
```

`recommendSuppliers`（`:141`）签名加 `hardConditions?: HardConditions`（直接随 data post）。

文件尾部追加：

```typescript
export function getHardConditionVocab(companyId?: string) {
  return api.get<HardConditionVocab>('/ai/hard-condition-vocab', companyId ? { companyId } : undefined);
}

export function suggestHardConditions(data: {
  projectContext?: Record<string, string>;
  industries?: string[];
  qualifications?: { key: string; label: string }[];
}) {
  return api.post<{ hardConditions: HardConditions }>('/ai/suggest-hard-conditions', data);
}
```

（`api.get` 第二参若不支持 query 对象，按同文件既有 GET 带参写法拼 query string——参照 `getTagVocabulary` 的实现形式。）

- [ ] **Step 2: 验证 + 提交**

Run: `cd apps/web && npx tsc --noEmit`
Expected: 干净

```bash
git add apps/web/src/lib/api/supplier.ts
git commit -m "feat(web): 供应商选取前端 API 层——硬性条件类型/词表/预填/推荐传参"
```

---

### Task 6: 向导步骤 1 硬性条件区 UI + 状态持久化 + AI 预填接线

**Files:**
- Create: `apps/web/src/app/(main)/supplier/selection/hard-conditions-section.tsx`
- Modify: `apps/web/src/app/(main)/supplier/selection/page.tsx`（状态/持久化/恢复/生成接线/run 传参/UI 挂载）

**Interfaces:**
- Consumes: Task 5 `HardConditions`/`HardConditionVocab`/`suggestHardConditions`/`getHardConditionVocab`。
- Produces: `HardConditionsSection({ vocab, value, onChange, disabled }: { vocab: HardConditionVocab | null; value: HardConditions; onChange: (v: HardConditions) => void; disabled?: boolean })`。

- [ ] **Step 1: 组件文件**

```tsx
// apps/web/src/app/(main)/supplier/selection/hard-conditions-section.tsx
'use client';
import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import type { HardConditions, HardConditionVocab } from '@/lib/api/supplier';

/** 硬性筛选条件区——词表全部来自库内（行业=库内聚合；资质=后端字典），机器三态核验（2026-11-04 spec） */
export function HardConditionsSection({ vocab, value, onChange, disabled }: {
  vocab: HardConditionVocab | null;
  value: HardConditions;
  onChange: (v: HardConditions) => void;
  disabled?: boolean;
}) {
  const [perfKeyword, setPerfKeyword] = useState('');

  const toggleIndustry = (name: string) => {
    const cur = value.industries || [];
    onChange({ ...value, industries: cur.includes(name) ? cur.filter((i) => i !== name) : [...cur, name] });
  };
  const toggleQualification = (key: string, label: string) => {
    const cur = value.qualifications || [];
    const hit = cur.find((q) => q.key === key);
    if (hit) onChange({ ...value, qualifications: cur.filter((q) => q.key !== key) });
    else onChange({ ...value, qualifications: [...cur, { key, required: true }] });
  };
  const setQualRequired = (key: string, required: boolean) => {
    onChange({ ...value, qualifications: (value.qualifications || []).map((q) => (q.key === key ? { ...q, required } : q)) });
  };
  const addPerfKeyword = () => {
    const k = perfKeyword.trim();
    if (!k) return;
    const cur = value.performance?.keywords || [];
    if (!cur.includes(k)) onChange({ ...value, performance: { ...value.performance, keywords: [...cur, k] } });
    setPerfKeyword('');
  };

  const hasAny = (value.industries?.length || 0) + (value.qualifications?.length || 0) > 0
    || !!(value.performance && (value.performance.years || value.performance.minCount || value.performance.keywords?.length))
    || !!value.minGrade;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">硬性筛选条件</label>
        {hasAny && (
          <button type="button" onClick={() => onChange({})} disabled={disabled} className="text-[10px] font-semibold text-[var(--muted-foreground)] hover:text-[var(--danger)]">清空</button>
        )}
      </div>

      {/* 行业（词表=库内行业+家数） */}
      <div className="flex flex-wrap gap-1.5">
        {(vocab?.industries || []).map((ind) => {
          const on = (value.industries || []).includes(ind.name);
          return (
            <button key={ind.name} type="button" onClick={() => toggleIndustry(ind.name)} disabled={disabled}
              className={`neu-chip ${on ? 'is-active' : ''}`}
              title={`库内该行业 ${ind.count} 家`}>
              {ind.name}<span className="ml-1 text-[9px] tabular-nums opacity-60">{ind.count}</span>
            </button>
          );
        })}
        {vocab && vocab.industries.length === 0 && <span className="text-[10px] text-[var(--muted-foreground)]">库内暂无入库供应商</span>}
        {!vocab && <span className="text-[10px] text-[var(--muted-foreground)]">词表加载中…</span>}
      </div>

      {/* 资质（字典）+ 必须/优先 */}
      {(value.qualifications || []).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(value.qualifications || []).map((q) => {
            const dict = vocab?.qualifications.find((d) => d.key === q.key);
            return (
              <span key={q.key} className="neu-chip is-active inline-flex items-center gap-1">
                {dict?.label || q.key}
                <select value={q.required ? 'required' : 'preferred'} disabled={disabled}
                  onChange={(e) => setQualRequired(q.key, e.target.value === 'required')}
                  className="bg-transparent text-[10px] font-semibold outline-none cursor-pointer">
                  <option value="required">必须</option>
                  <option value="preferred">优先</option>
                </select>
                <button type="button" onClick={() => toggleQualification(q.key, '')} disabled={disabled}><X size={10} /></button>
              </span>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {(vocab?.qualifications || []).filter((d) => !(value.qualifications || []).some((q) => q.key === d.key)).map((d) => (
          <button key={d.key} type="button" onClick={() => toggleQualification(d.key, d.label)} disabled={disabled}
            className="neu-chip" title={d.category}>{d.label}</button>
        ))}
      </div>

      {/* 业绩 + 评价等级 */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">业绩</span>
        <span className="text-[var(--muted-foreground)]">近</span>
        <input type="number" min={1} max={10} value={value.performance?.years ?? ''} disabled={disabled}
          onChange={(e) => onChange({ ...value, performance: { ...value.performance, years: e.target.value ? Number(e.target.value) : undefined } })}
          className="workbench-input !w-[52px] !h-7 !text-xs" placeholder="年限" />
        <span className="text-[var(--muted-foreground)]">年 ≥</span>
        <input type="number" min={1} max={99} value={value.performance?.minCount ?? ''} disabled={disabled}
          onChange={(e) => onChange({ ...value, performance: { ...value.performance, minCount: e.target.value ? Number(e.target.value) : undefined } })}
          className="workbench-input !w-[52px] !h-7 !text-xs" placeholder="数量" />
        <span className="text-[var(--muted-foreground)]">项 关键词</span>
        {(value.performance?.keywords || []).map((k) => (
          <span key={k} className="neu-chip is-active inline-flex items-center gap-1">{k}
            <button type="button" disabled={disabled} onClick={() => onChange({ ...value, performance: { ...value.performance, keywords: (value.performance?.keywords || []).filter((x) => x !== k) } })}><X size={10} /></button>
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <input value={perfKeyword} onChange={(e) => setPerfKeyword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPerfKeyword(); } }}
            className="workbench-input !w-[88px] !h-7 !text-xs" placeholder="如：钻机" disabled={disabled} />
          <button type="button" onClick={addPerfKeyword} disabled={disabled || !perfKeyword.trim()} className="neu-btn-xs !h-7 !px-2"><Plus size={11} /></button>
        </span>
        <span className="ml-3 text-[10px] font-semibold text-[var(--muted-foreground)]">评价等级</span>
        <select value={value.minGrade || ''} disabled={disabled}
          onChange={(e) => onChange({ ...value, minGrade: (e.target.value || undefined) as HardConditions['minGrade'] })}
          className="workbench-input !w-[72px] !h-7 !text-xs">
          <option value="">不限</option><option value="A">≥A</option><option value="B">≥B</option><option value="C">≥C</option>
        </select>
      </div>
    </div>
  );
}
```

（`neu-chip` 若全局无此类，参照同页 `BusinessTagsPicker` 的 chip 类名替换——执行时以该组件实际用法为准，保持一致视觉。）

- [ ] **Step 2: page.tsx 接线**

1. import：`HardConditionsSection`、`getHardConditionVocab, suggestHardConditions`、类型 `HardConditions, HardConditionVocab`。
2. 状态（`:232` selectedTags 附近）：

```typescript
  const [hardConditions, setHardConditions] = useState<HardConditions>({});
  const [hardVocab, setHardVocab] = useState<HardConditionVocab | null>(null);
  const hardCondUserEditedRef = useRef(false); // 手动改过 → AI 预填不再覆盖
  const markHardCondEdited = () => { hardCondUserEditedRef.current = true; };
```

词表加载（挂载一次性，`sessionRestored` 后）：

```typescript
  useEffect(() => {
    if (!sessionRestored || hardVocab) return;
    getHardConditionVocab().then(setHardVocab).catch(() => setHardVocab({ industries: [], qualifications: [] }));
  }, [sessionRestored, hardVocab]);
```

3. 持久化写（`:799` localStorage.setItem payload 对象内加 `hardConditions,`；deps 数组加 `hardConditionsSnapshot`，snapshot 定义仿 requirementSnapshot：`const hardConditionsSnapshot = JSON.stringify(hardConditions);`）。恢复（`applySnapshot` 内 `state.selectedTags` 段后）：

```typescript
        if (state.hardConditions && typeof state.hardConditions === 'object') {
          setHardConditions(state.hardConditions);
          if ((state.hardConditions.industries?.length || 0) + (state.hardConditions.qualifications?.length || 0) > 0 || state.hardConditions.minGrade) markHardCondEdited();
        }
```

4. `generateRequirement`（`:1052`）——在 `polishRequirement` 调用同段加并行预填（AI 按钮一次点击填两层）：

```typescript
      // 硬性条件 AI 预填：与五段文本并行；手动改过则跳过（同业务标签 tagsUserEdited 范式）
      const hardSuggest = hardCondUserEditedRef.current || !hardVocab
        ? Promise.resolve(null)
        : suggestHardConditions({
            projectContext: Object.fromEntries(contextParts.length > 0 ? [['项目背景', contextParts.join('\n').slice(0, 4000)]] : []),
            industries: hardVocab.industries.map((i) => i.name),
            qualifications: hardVocab.qualifications.map((q) => ({ key: q.key, label: q.label })),
          }).catch(() => null);
      // （在 await polishRequirement 处改为）：
      const [res, hardRes] = await Promise.all([polishRequirement({ ... }), hardSuggest]);
      parsePolishedResult(res.polished);
      if (hardRes?.hardConditions && !hardCondUserEditedRef.current) setHardConditions(hardRes.hardConditions);
```

5. `run()`（`:975`）与补选（`:995`、`:1545`）的 `recommendSuppliers({...})` 加 `hardConditions: (hardConditions.industries?.length || hardConditions.qualifications?.length || hardConditions.minGrade || hardConditions.performance?.years || hardConditions.performance?.minCount || hardConditions.performance?.keywords?.length) ? hardConditions : undefined`。（抽局部 `const activeHardConditions = ...` 复用三处。）
6. UI 挂载：「供应商要求」卡（`:2140`）header 行与「项目概况」之间插入：

```tsx
            <div className="wb-section-rule" />
            <HardConditionsSection vocab={hardVocab} value={hardConditions} disabled={actionsDisabledGlobal !== undefined ? actionsDisabledGlobal : false} onChange={(v) => { markHardCondEdited(); setHardConditions(v); }} />
            <div className="wb-section-rule" />
```

（`disabled` 无全局禁用概念则恒 false——直接不传。）

- [ ] **Step 3: 验证 + 提交**

Run: `cd apps/web && npx tsc --noEmit`
Expected: 干净

```bash
git add "apps/web/src/app/(main)/supplier/selection/hard-conditions-section.tsx" "apps/web/src/app/(main)/supplier/selection/page.tsx"
git commit -m "feat(web): 供应商选取向导——硬性筛选条件区（词表chips+业绩/评价）+AI预填+持久化"
```

---

### Task 7: 步骤 2 核验矩阵 + 剔除名单展示

**Files:**
- Modify: `apps/web/src/app/(main)/supplier/selection/page.tsx`（推荐卡 ~`:1747`、摘要卡统计行 ~`:2260`）

**Interfaces:**
- Consumes: Task 5 `conditionsCheck`/`filteredOut` 字段。

- [ ] **Step 1: 核验矩阵渲染函数**

page.tsx 内（组件函数外或内，与其它 helper 同层）加：

```tsx
  const renderChecksMatrix = (supplierId: string, result: SupplierSelectionResult | null) => {
    const checks = result?.conditionsCheck?.find((c) => c.supplierId === supplierId)?.checks;
    if (!checks || checks.length === 0) return null;
    return (
      <div className="mt-1.5 flex flex-wrap gap-1">
        {checks.map((ch) => (
          <span key={`${ch.type}-${ch.label}`} title={ch.detail || ({ PASS: '已核验满足', MISSING: '库内未见该资料，请人工核实', FAIL: '不满足' } as const)[ch.status]}
            className={`rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold ${ch.status === 'PASS' ? (ch.required ? 'text-[var(--success)]' : 'text-[var(--muted-foreground)]') : ch.status === 'MISSING' ? 'text-[var(--warning)]' : 'text-[var(--danger)]'}`}
            style={{ background: `color-mix(in oklch, var(${ch.status === 'PASS' ? (ch.required ? '--success' : '--muted-foreground') : ch.status === 'MISSING' ? '--warning' : '--danger'}) 10%, transparent)` }}>
            {ch.label}{ch.status === 'PASS' ? '✓' : ch.status === 'MISSING' ? '○' : '✗'}
          </span>
        ))}
      </div>
    );
  };
```

（非必须级 PASS 用 muted 灰——「优先项灰✓」口径。）

- [ ] **Step 2: 推荐卡挂载**

主推荐列表（`:1747` 附近 `r.tags` 渲染段之后、卡片容器内）追加 `{renderChecksMatrix(r.supplierId, result)}`；补选结果卡（rerunResult 的推荐渲染处）追加 `{renderChecksMatrix(r.supplierId, rerunResult)}`。

- [ ] **Step 3: 摘要卡剔除名单**

统计行（`:2260`「候选池 N 推荐 M」处）追加（需一个展开 state：`const [showFilteredOut, setShowFilteredOut] = useState(false);` 放组件顶部状态区）：

```tsx
                    {result.filteredOut && result.filteredOut.length > 0 && (
                      <button type="button" onClick={() => setShowFilteredOut((v) => !v)} className="text-[var(--warning)] font-semibold hover:underline">
                        硬性条件剔除 {result.filteredOut.length} 家{showFilteredOut ? '（收起）' : '（查看）'}
                      </button>
                    )}
```

摘要卡 `<p>` 之后：

```tsx
                  {showFilteredOut && result.filteredOut && (
                    <div className="mt-2 max-h-40 overflow-y-auto rounded-xl p-2 text-xs leading-5" style={{ background: 'color-mix(in oklch, var(--warning) 6%, transparent)' }}>
                      {result.filteredOut.map((f) => (
                        <div key={f.supplierId} className="flex justify-between gap-3">
                          <span className="font-semibold text-[var(--foreground)]">{f.name}</span>
                          <span className="text-[var(--muted-foreground)]">{f.failedCondition}</span>
                        </div>
                      ))}
                    </div>
                  )}
```

- [ ] **Step 4: 验证 + 提交**

Run: `cd apps/web && npx tsc --noEmit`
Expected: 干净

```bash
git add "apps/web/src/app/(main)/supplier/selection/page.tsx"
git commit -m "feat(web): 推荐结果核验矩阵（✓/○/✗三态）+硬性剔除名单展开"
```

---

### Task 8: 全量验证

- [ ] **Step 1: 后端域测试**

Run: `cd apps/api && npx jest src/ai && npx tsc --noEmit`
Expected: ai 域全绿（含既有 spec 无回归）

- [ ] **Step 2: 供应商域防跨破坏**

Run: `cd apps/api && npx jest supplier`
Expected: 全绿（supplier 域测试口径——窄跑漏跨 spec 是实录坑）

- [ ] **Step 3: 前端**

Run: `cd apps/web && npx tsc --noEmit && npx --filter web lint 2>/dev/null || pnpm --filter web lint`
Expected: 干净

- [ ] **Step 4: 手工验收清单**（dev 环境起后）

1. :3005 → 供应商管理 → 供应商选择 → 选项目 → 步骤 1 出现「硬性筛选条件」区，行业 chips 带家数、资质字典可多选并切必须/优先。
2. 点「AI 按项目文件生成」：五段文本 + 硬性条件同时预填（AI 选不出留空）。
3. 设一个库内必然 FAIL 的行业条件（如「餐饮业」）→ 推荐结果摘要显示「硬性条件剔除 N 家（查看）」，展开见名单与原因。
4. 设 ISO9001 必须 → 推荐卡出现资质核验 chip（多为 ○ 资料缺失黄标，悬停有提示）。
5. 不设任何硬性条件 → 推荐流程与改造前一致（回归）。
6. 刷新页面 → 硬性条件从草稿恢复；手动改过后再点 AI 生成不覆盖手选值。

- [ ] **Step 5: 收尾提交（如有零星修正）**

```bash
git add <仅改动文件>
git commit -m "fix(web): 硬性条件验收修正"
```

---

## Self-Review 记录

- **Spec 覆盖**：生成侧词表化（Task 3+6）、三态核验+FAIL 剔除/MISSING 保留（Task 1+2）、LLM 证据增强+不虚构铁律（Task 4）、推荐卡矩阵+剔除名单（Task 7）、不传零破坏（Task 2 sanitize+empty 判定）——全覆盖。非目标未混入。
- **类型一致性**：`HardConditions`/`ConditionCheck` Task 1 定义、Task 2 re-export、Task 5 前端镜像同名；`buildCandidateLines` 签名与 Task 4 调用一致；`rankCandidates` 第五参与 ai.service 两处调用一致。
- **已知取舍**：`SupplierSelectionResult.candidatePool` 语义=过滤后进 n-gram 的池（不另拆「过滤前总数」字段——filteredOut.length 已可推导）；业绩摘要「近期业绩 N 项」为话术非精确 3 年窗（LLM 参照用，核验判定在规则层精确计算）。
