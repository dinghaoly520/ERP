# 补正变更清单（快照自动比对）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 退回补正重提后，审批侧自动展示「本次补正改了什么」——退回时点快照 vs 当前申请快照逐字段比对生成变更清单。

**Architecture:** 后端新增纯函数 `buildCorrectionDiff(oldSnap, newSnap)`（两侧同构快照、PII 即掩码形态，直接比对）+ 只读端点 `GET /supplier/:id/correction-diff`（无写路径）；`buildApprovalSnapshot` 补 `companyId/companyName/establishedDate/companyProfile` 四字段（补正可改、现快照缺失——**对 spec §3.2 的同向扩充**，交付时向用户说明）。前端 :3005 两处展示（详情页 hero 下方 + 审批中心弹窗审核进度块之后），共享组件 `CorrectionDiffList`。

**Tech Stack:** NestJS 11 + Prisma（API）；Next.js 16 + React 19 + Tailwind v4（web）；Jest 单测。

## Global Constraints

- spec：`docs/superpowers/specs/2026-11-24-supplier-correction-diff-design.md`（触发口径=存在 RETURNED 留痕且 status∈{RETURNED,PENDING}；终局态 hasRound=false）
- **spec 补充（已向用户说明）**：快照补字段为 companyId/companyName/establishedDate/**companyProfile** 四项——companyProfile（企业简介）同属补正可改字段，快照现缺
- 文案禁机制词：界面只出现「本次补正变更」「文件已更换」「新增」「移除」，禁「快照/自动比对/留痕」等实现词（ui-copy-no-mechanism-leak-ruling）
- PII：两侧快照出口即掩码（maskIdNumber/maskPhone/maskEmail/maskBankAccount），diff 直接比对掩码值，前端不额外脱敏
- 旧快照缺键字段跳过不误报（存量快照无新增四键）
- 仓库惯例：main 直接提交；`git -C /Users/qihao/ERP2/ERP add <明确路径>`（禁 add -A）；提交信息中文 + `fix(supplier):`/`feat(supplier):` 前缀 + `Co-Authored-By: Claude Code <noreply@anthropic.com>`
- react-compiler 坑：modal 的选中 effect 已有 `eslint-disable react-hooks/set-state-in-effect` 区间，setDiff 调用放区间内；新组件不引入前向引用

---

### Task 1: correction-diff.util 纯函数（TDD）

**Files:**
- Create: `apps/api/src/supplier/correction-diff.util.ts`
- Test: `apps/api/src/supplier/correction-diff.util.spec.ts`

**Interfaces:**
- Consumes: 无（纯函数，入参为 `buildApprovalSnapshot` 形状的对象）
- Produces: `buildCorrectionDiff(oldSnap: Record<string, unknown> | null | undefined, newSnap: 同): CorrectionDiffSection[]`；类型 `CorrectionDiffItem { kind: 'modified'|'added'|'removed'; rowLabel: string; fieldLabel?: string; oldValue?: string; newValue?: string; fileReplaced?: boolean }`、`CorrectionDiffSection { key: 'main'|'account'|'contacts'|'qualifications'|'bankAccounts'|'performances'; label: string; items: CorrectionDiffItem[] }`——Task 2/3/4 按此消费

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/supplier/correction-diff.util.spec.ts
import { buildCorrectionDiff } from './correction-diff.util';

const baseSnap = () => ({
  name: '成都测试商贸有限公司', creditCode: '91510100MA00000000', supplierNo: 'SUP-000001',
  enterpriseType: '有限责任公司', legalPerson: '张三', legalPersonIdCard: '5101**********0011', legalPersonPhone: '135****0000',
  registeredAddress: '成都市XX路1号', detailedAddress: null, businessScope: '销售建材',
  logoUrl: null, organizationCode: null, country: '中国', region: '四川', registeredCapital: '100万元',
  industry: '零售业', companyEmail: null, companyWebsite: null, companyProfile: null,
  tags: ['建材物资销售'], establishedDate: '2016-05-30',
  companyId: 'co-1', companyName: '四川水发兴川置业管理有限公司',
  account: { username: 'u1', displayName: '测试', email: null },
  contacts: [{ name: '李四', gender: '男', phone: '139****1111', idCard: '5101**********2222', email: null, position: '经理', isPrimary: true }],
  qualifications: [{ type: '营业执照', name: '营业执照', fileUrl: '/api/upload/files/f1', attachments: [], validFrom: null, validTo: null }],
  bankAccounts: [], performances: [],
});

describe('buildCorrectionDiff（补正变更清单，2026-11-24 spec）', () => {
  it('主档字段变更只列变化项（掩码值直接比对）', () => {
    const n = { ...baseSnap(), registeredCapital: '500万元' } as Record<string, unknown>;
    const sections = buildCorrectionDiff(baseSnap() as Record<string, unknown>, n);
    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe('main');
    expect(sections[0].items).toEqual([
      { kind: 'modified', rowLabel: '注册资金（万元）', oldValue: '100万元', newValue: '500万元' },
    ]);
  });

  it('旧快照缺键的字段跳过（存量快照无 companyId/establishedDate/companyProfile）', () => {
    const o = baseSnap() as Record<string, unknown>;
    delete o.companyId; delete o.companyName; delete o.establishedDate; delete o.companyProfile;
    const n = { ...baseSnap(), companyName: '四川水发建设有限公司' } as Record<string, unknown>;
    expect(buildCorrectionDiff(o, n)).toEqual([]);
  });

  it('子表行修改/新增 + 资质证照文件替换标记', () => {
    const o = baseSnap() as Record<string, unknown>;
    const n = { ...baseSnap(),
      contacts: [
        { name: '李四', gender: '男', phone: '138****9999', idCard: '5101**********2222', email: null, position: '经理', isPrimary: true },
        { name: '王五', gender: '女', phone: '137****0000', idCard: null, email: null, position: null, isPrimary: false },
      ],
      qualifications: [{ type: '营业执照', name: '营业执照', fileUrl: '/api/upload/files/f2', attachments: [], validFrom: null, validTo: null }],
    } as Record<string, unknown>;
    const sections = buildCorrectionDiff(o, n);
    const contactsSec = sections.find(s => s.key === 'contacts')!;
    expect(contactsSec.items).toContainEqual({ kind: 'modified', rowLabel: '主要联系人 李四', fieldLabel: '联系电话', oldValue: '139****1111', newValue: '138****9999' });
    expect(contactsSec.items).toContainEqual({ kind: 'added', rowLabel: '联系人 王五' });
    const qualsSec = sections.find(s => s.key === 'qualifications')!;
    expect(qualsSec.items).toEqual([{ kind: 'modified', rowLabel: '营业执照', fieldLabel: '证照原件', fileReplaced: true }]);
  });

  it('银行账户/主体业绩行修改与删除', () => {
    const o = { ...baseSnap(),
      bankAccounts: [{ id: 'b1', accountName: '对公账户', bankName: '工商银行', bankBranch: null, accountNo: '6222************1111', isDefault: true }],
      performances: [{ id: 'p1', projectName: 'X水库维修', clientName: '某水务局', contractAmount: '300万元', signDate: '2025-01-01', description: null, proofFiles: [] }],
    } as Record<string, unknown>;
    const n = { ...baseSnap(),
      bankAccounts: [{ id: 'b2', accountName: '对公账户', bankName: '建设银行', bankBranch: null, accountNo: '6222************1111', isDefault: true }],
      performances: [],
    } as Record<string, unknown>;
    const sections = buildCorrectionDiff(o, n);
    expect(sections.find(s => s.key === 'bankAccounts')!.items).toContainEqual(
      { kind: 'modified', rowLabel: '对公账户（工商银行）', fieldLabel: '开户银行', oldValue: '工商银行', newValue: '建设银行' });
    expect(sections.find(s => s.key === 'performances')!.items).toEqual([{ kind: 'removed', rowLabel: 'X水库维修' }]);
  });

  it('归属公司变更（按 companyId 门槛、展示 companyName）', () => {
    const o = baseSnap() as Record<string, unknown>;
    const n = { ...baseSnap(), companyId: 'co-2', companyName: '四川水发建设有限公司' } as Record<string, unknown>;
    const sections = buildCorrectionDiff(o, n);
    expect(sections[0].items).toContainEqual(
      { kind: 'modified', rowLabel: '归属公司', oldValue: '四川水发兴川置业管理有限公司', newValue: '四川水发建设有限公司' });
  });

  it('tags 多值并列展示', () => {
    const o = baseSnap() as Record<string, unknown>;
    const n = { ...baseSnap(), tags: ['建材物资销售', '工程物资销售'] } as Record<string, unknown>;
    const sections = buildCorrectionDiff(o, n);
    expect(sections[0].items[0]).toMatchObject({ rowLabel: '业务标签', oldValue: '建材物资销售', newValue: '建材物资销售、工程物资销售' });
  });

  it('无变化 → 空数组；任一侧快照缺失 → 空数组', () => {
    expect(buildCorrectionDiff(baseSnap() as Record<string, unknown>, baseSnap() as Record<string, unknown>)).toEqual([]);
    expect(buildCorrectionDiff(null, baseSnap() as Record<string, unknown>)).toEqual([]);
    expect(buildCorrectionDiff(undefined, undefined)).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/qihao/ERP2/ERP/water-erp/apps/api && pnpm jest correction-diff.util --silent`
Expected: FAIL（模块不存在 / buildCorrectionDiff is not a function）

- [ ] **Step 3: 实现 `correction-diff.util.ts`**

```ts
// apps/api/src/supplier/correction-diff.util.ts
/**
 * 补正变更清单（2026-11-24 spec：docs/superpowers/specs/2026-11-24-supplier-correction-diff-design.md）
 * 退回时点快照 vs 当前申请快照逐字段比对，只输出有变化的项。两侧快照同构
 * （buildApprovalSnapshot 产出、PII 出口即掩码形态），掩码值直接比对。
 * 旧快照缺键的字段跳过（存量快照无新增键时不误报）；无变化返回空数组。
 */

export type CorrectionDiffKind = 'modified' | 'added' | 'removed';

export interface CorrectionDiffItem {
  kind: CorrectionDiffKind;
  rowLabel: string;
  fieldLabel?: string;
  oldValue?: string;
  newValue?: string;
  fileReplaced?: boolean;
}

export interface CorrectionDiffSection {
  key: 'main' | 'account' | 'contacts' | 'qualifications' | 'bankAccounts' | 'performances';
  label: string;
  items: CorrectionDiffItem[];
}

type Snap = Record<string, unknown> | null | undefined;
type Row = Record<string, unknown>;

const dash = (v: unknown): string => (v === undefined || v === null || v === '' ? '—' : String(v));

/** 主档比对字段：key 为旧快照存在性门槛（缺键跳过），pick 为两侧统一取值（展示形态） */
const MAIN_FIELDS: Array<{ key: string; label: string; pick: (s: Row) => string }> = [
  { key: 'name', label: '公司名称', pick: (s) => dash(s.name) },
  { key: 'enterpriseType', label: '公司体制类型', pick: (s) => dash(s.enterpriseType) },
  { key: 'legalPerson', label: '法人姓名', pick: (s) => dash(s.legalPerson) },
  { key: 'legalPersonIdCard', label: '法人身份证号', pick: (s) => dash(s.legalPersonIdCard) },
  { key: 'legalPersonPhone', label: '法人联系电话', pick: (s) => dash(s.legalPersonPhone) },
  { key: 'registeredAddress', label: '注册地址', pick: (s) => dash(s.registeredAddress) },
  { key: 'detailedAddress', label: '详细地址', pick: (s) => dash(s.detailedAddress) },
  { key: 'businessScope', label: '主要经营业务范围', pick: (s) => dash(s.businessScope) },
  { key: 'country', label: '国别 / 行政区域', pick: (s) => [s.country, s.region].filter(Boolean).join(' · ') || '—' },
  { key: 'registeredCapital', label: '注册资金（万元）', pick: (s) => dash(s.registeredCapital) },
  { key: 'establishedDate', label: '成立日期', pick: (s) => dash(s.establishedDate) },
  { key: 'industry', label: '所属的国民经济行业', pick: (s) => dash(s.industry) },
  { key: 'organizationCode', label: '组织机构代码', pick: (s) => dash(s.organizationCode) },
  { key: 'companyId', label: '归属公司', pick: (s) => dash(s.companyName ?? s.companyId) },
  { key: 'companyEmail', label: '公司邮箱', pick: (s) => dash(s.companyEmail) },
  { key: 'companyWebsite', label: '公司官网地址', pick: (s) => dash(s.companyWebsite) },
  { key: 'companyProfile', label: '企业简介', pick: (s) => dash(s.companyProfile) },
  { key: 'tags', label: '业务标签', pick: (s) => (Array.isArray(s.tags) && s.tags.length ? (s.tags as unknown[]).join('、') : '—') },
];

const CHILD_SECTIONS: Array<{
  key: CorrectionDiffSection['key']; label: string; arrKey: string;
  keyOf: (r: Row) => string;
  rowLabelOf: (r: Row) => string;
  fields: Array<{ key: string; label: string; pick: (r: Row) => string; file?: boolean }>;
}> = [
  {
    key: 'contacts', label: '联系人', arrKey: 'contacts',
    keyOf: (r) => (r.isPrimary ? '1|' : '0|') + dash(r.name),
    rowLabelOf: (r) => `${r.isPrimary ? '主要联系人' : '联系人'} ${dash(r.name)}`,
    fields: [
      { key: 'gender', label: '性别', pick: (r) => dash(r.gender) },
      { key: 'phone', label: '联系电话', pick: (r) => dash(r.phone) },
      { key: 'idCard', label: '身份证号', pick: (r) => dash(r.idCard) },
      { key: 'email', label: '邮箱', pick: (r) => dash(r.email) },
      { key: 'position', label: '部门职务', pick: (r) => dash(r.position) },
    ],
  },
  {
    key: 'qualifications', label: '资质证照', arrKey: 'qualifications',
    keyOf: (r) => dash(r.type) + '|' + dash(r.name),
    rowLabelOf: (r) => dash(r.name) === '—' ? dash(r.type) : (r.name === r.type ? dash(r.name) : `${dash(r.type)}·${dash(r.name)}`),
    fields: [
      { key: 'validFrom', label: '有效期始', pick: (r) => dash(r.validFrom) },
      { key: 'validTo', label: '有效期止', pick: (r) => dash(r.validTo) },
      { key: 'fileUrl', label: '证照原件', pick: (r) => String(r.fileUrl ?? ''), file: true },
      { key: 'attachments', label: '附件材料', pick: (r) => JSON.stringify(r.attachments ?? null), file: true },
    ],
  },
  {
    key: 'bankAccounts', label: '银行账户', arrKey: 'bankAccounts',
    keyOf: (r) => (dash(r.accountNo) === '—' ? `id:${dash(r.id)}` : dash(r.accountNo)),
    rowLabelOf: (r) => `${dash(r.accountName)}（${dash(r.bankName)}）`,
    fields: [
      { key: 'accountName', label: '账户名称', pick: (r) => dash(r.accountName) },
      { key: 'bankName', label: '开户银行', pick: (r) => dash(r.bankName) },
      { key: 'bankBranch', label: '开户支行', pick: (r) => dash(r.bankBranch) },
      { key: 'accountNo', label: '银行账号', pick: (r) => dash(r.accountNo) },
      { key: 'isDefault', label: '默认账户', pick: (r) => (r.isDefault ? '是' : '否') },
    ],
  },
  {
    key: 'performances', label: '主体业绩', arrKey: 'performances',
    keyOf: (r) => (dash(r.projectName) === '—' ? `id:${dash(r.id)}` : dash(r.projectName)),
    rowLabelOf: (r) => dash(r.projectName),
    fields: [
      { key: 'clientName', label: '客户名称', pick: (r) => dash(r.clientName) },
      { key: 'contractAmount', label: '合同金额', pick: (r) => dash(r.contractAmount) },
      { key: 'signDate', label: '签订日期', pick: (r) => dash(r.signDate) },
      { key: 'description', label: '项目描述', pick: (r) => dash(r.description) },
      { key: 'proofFiles', label: '证明材料', pick: (r) => JSON.stringify(r.proofFiles ?? null), file: true },
    ],
  },
];

function diffMain(o: Row, n: Row): CorrectionDiffSection | null {
  const items: CorrectionDiffItem[] = [];
  for (const f of MAIN_FIELDS) {
    if (!(f.key in o)) continue; // 旧快照缺键跳过（存量快照无新增键）
    const ov = f.pick(o), nv = f.pick(n);
    if (ov === nv) continue;
    items.push({ kind: 'modified', rowLabel: f.label, oldValue: ov, newValue: nv });
  }
  if ('logoUrl' in o) {
    const ov = o.logoUrl ?? null, nv = n.logoUrl ?? null;
    if (ov !== nv) items.push({ kind: 'modified', rowLabel: '企业标志', fileReplaced: true });
  }
  return items.length ? { key: 'main', label: '企业信息', items } : null;
}

function diffAccount(o: Row, n: Row): CorrectionDiffSection | null {
  const ao = o.account as Row | undefined, an = n.account as Row | undefined;
  if (!ao) return null; // 旧快照缺 account 键跳过
  const fields: Array<{ key: string; label: string }> = [
    { key: 'username', label: '登录名' }, { key: 'displayName', label: '显示名' }, { key: 'email', label: '邮箱' },
  ];
  const items: CorrectionDiffItem[] = [];
  for (const f of fields) {
    const ov = dash(ao?.[f.key]), nv = dash(an?.[f.key]);
    if (ov !== nv) items.push({ kind: 'modified', rowLabel: f.label, oldValue: ov, newValue: nv });
  }
  return items.length ? { key: 'account', label: '登录账号', items } : null;
}

/** 子表行比对：按 keyOf 配对（同名多行按出现顺序一一配对），多出的行 → added/removed */
function diffChild(o: Row, n: Row, def: (typeof CHILD_SECTIONS)[number]): CorrectionDiffSection | null {
  const group = (rows: Row[]) => {
    const m = new Map<string, Row[]>();
    for (const r of rows) { const k = def.keyOf(r); if (!k) continue; const arr = m.get(k); if (arr) arr.push(r); else m.set(k, [r]); }
    return m;
  };
  const oldRows = Array.isArray(o[def.arrKey]) ? (o[def.arrKey] as Row[]) : [];
  const newRows = Array.isArray(n[def.arrKey]) ? (n[def.arrKey] as Row[]) : [];
  const om = group(oldRows), nm = group(newRows);
  const items: CorrectionDiffItem[] = [];
  for (const [k, olds] of om) {
    const news = nm.get(k);
    if (!news) { items.push({ kind: 'removed', rowLabel: def.rowLabelOf(olds[0]) }); continue; }
    const paired = Math.min(olds.length, news.length);
    for (let i = 0; i < paired; i++) {
      const ro = olds[i], rn = news[i];
      for (const f of def.fields) {
        if (!(f.key in ro)) continue; // 旧快照缺键跳过
        const ov = f.pick(ro), nv = f.pick(rn);
        if (ov === nv) continue;
        items.push(f.file
          ? { kind: 'modified', rowLabel: def.rowLabelOf(ro), fieldLabel: f.label, fileReplaced: true }
          : { kind: 'modified', rowLabel: def.rowLabelOf(ro), fieldLabel: f.label, oldValue: ov, newValue: nv });
      }
    }
    for (let i = paired; i < news.length; i++) items.push({ kind: 'added', rowLabel: def.rowLabelOf(news[i]) });
  }
  for (const [k, news] of nm) if (!om.has(k)) for (const r of news) items.push({ kind: 'added', rowLabel: def.rowLabelOf(r) });
  return items.length ? { key: def.key, label: def.label, items } : null;
}

export function buildCorrectionDiff(oldSnap: Snap, newSnap: Snap): CorrectionDiffSection[] {
  if (!oldSnap || !newSnap) return [];
  const o = oldSnap as Row, n = newSnap as Row;
  const sections: CorrectionDiffSection[] = [];
  const main = diffMain(o, n);
  if (main) sections.push(main);
  const account = diffAccount(o, n);
  if (account) sections.push(account);
  for (const def of CHILD_SECTIONS) {
    const sec = diffChild(o, n, def);
    if (sec) sections.push(sec);
  }
  return sections;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm jest correction-diff.util --silent`
Expected: PASS（7 用例全绿）

- [ ] **Step 5: 提交**

```bash
git -C /Users/qihao/ERP2/ERP add water-erp/apps/api/src/supplier/correction-diff.util.ts water-erp/apps/api/src/supplier/correction-diff.util.spec.ts
git -C /Users/qihao/ERP2/ERP commit -m "feat(supplier): 补正变更清单 diff 纯函数——退回时点快照 vs 当前申请逐字段比对（掩码口径、旧快照缺键跳过）

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 快照补字段 + correction-diff 端点（TDD）

**Files:**
- Modify: `apps/api/src/supplier/supplier.service.ts`（`buildApprovalSnapshot` :2262-2264 区域补四字段；`getApprovalHistory` :2007 之后新增 `getCorrectionDiff`）
- Modify: `apps/api/src/supplier/supplier.controller.ts`（:169 approval-history 块之后新增路由）
- Test: `apps/api/src/supplier/supplier-correction-diff.spec.ts`

**Interfaces:**
- Consumes: Task 1 `buildCorrectionDiff` / `CorrectionDiffSection`
- Produces: `SupplierService.getCorrectionDiff(supplierId: string): Promise<{ hasRound: boolean; returnedAt?: string; returnReason?: string | null; sections?: CorrectionDiffSection[] }>`；路由 `GET /supplier/:id/correction-diff`（@Roles admin/leader/staff）——Task 3/4 前端消费

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/supplier/supplier-correction-diff.spec.ts
import { NotFoundException } from '@nestjs/common';
import { SupplierService } from './supplier.service';

/** 直构 service（同 supplier-review-status-gate.spec 口径）：getCorrectionDiff 只依赖 prisma */
const mkSvc = (supplierRow: Record<string, unknown> | null) => {
  const prisma = {
    supplier: { findUnique: jest.fn().mockResolvedValue(supplierRow) },
    supplierApprovalRecord: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const svc = new (SupplierService as any)(prisma, {}, null, null, null, null);
  return { prisma, svc };
};

const SUP = () => ({
  id: 'sup-1', name: '成都测试商贸有限公司', creditCode: '91510100MA00000000', supplierNo: 'SUP-000001',
  enterpriseType: '有限责任公司', legalPerson: '张三', legalPersonIdCard: null, legalPersonPhone: null,
  registeredAddress: '成都市XX路1号', detailedAddress: null, businessScope: '销售建材',
  logoUrl: null, organizationCode: null, country: '中国', region: '四川', registeredCapital: '100万元',
  industry: '零售业', companyEmail: null, companyWebsite: null, companyProfile: null,
  tags: ['建材物资销售'], isTemporary: false, establishedDate: new Date('2016-05-29T16:00:00.000Z'),
  companyId: 'co-1', companyName: '四川水发兴川置业管理有限公司', status: 'PENDING',
  user: { username: 'u1', displayName: '测试', email: null },
  contacts: [], qualifications: [], bankAccounts: [], performances: [],
});

describe('getCorrectionDiff + 快照补字段（2026-11-24 spec）', () => {
  it('buildApprovalSnapshot 补 companyId/companyName/establishedDate/companyProfile', async () => {
    const { svc } = mkSvc(SUP());
    const snap = await (svc as any).buildApprovalSnapshot('sup-1');
    expect(snap.companyId).toBe('co-1');
    expect(snap.companyName).toBe('四川水发兴川置业管理有限公司');
    expect(snap.establishedDate).toBe('2016-05-30');
    expect(snap.companyProfile).toBeNull();
  });

  it('无 RETURNED 留痕 → hasRound=false', async () => {
    const { prisma, svc } = mkSvc(SUP());
    const r = await svc.getCorrectionDiff('sup-1');
    expect(r).toEqual({ hasRound: false });
    expect(prisma.supplierApprovalRecord.findFirst).toHaveBeenCalled();
  });

  it('RETURNED 未重提 → hasRound=true、sections=[]、退回原因取留痕记录', async () => {
    const { prisma, svc } = mkSvc({ ...SUP(), status: 'RETURNED', returnReason: null });
    const live = await (svc as any).buildApprovalSnapshot('sup-1');
    prisma.supplierApprovalRecord.findFirst.mockResolvedValue({
      createdAt: new Date('2026-11-20T08:00:00.000Z'), reason: '资质材料不清晰', snapshot: live,
    });
    const r = await svc.getCorrectionDiff('sup-1');
    expect(r.hasRound).toBe(true);
    expect(r.sections).toEqual([]);
    expect(r.returnReason).toBe('资质材料不清晰'); // Supplier.returnReason=null（被缺陷清空）不影响
    expect(r.returnedAt).toBe('2026-11-20T08:00:00.000Z');
  });

  it('重提后 PENDING → 清单非空（字段 旧→新）', async () => {
    const { prisma, svc } = mkSvc({ ...SUP(), registeredCapital: '500万元' });
    const live = await (svc as any).buildApprovalSnapshot('sup-1');
    prisma.supplierApprovalRecord.findFirst.mockResolvedValue({
      createdAt: new Date('2026-11-20T08:00:00.000Z'), reason: '请修正注册资金',
      snapshot: { ...live, registeredCapital: '100万元' },
    });
    const r = await svc.getCorrectionDiff('sup-1');
    expect(r.hasRound).toBe(true);
    expect(r.sections[0].items).toContainEqual(
      { kind: 'modified', rowLabel: '注册资金（万元）', oldValue: '100万元', newValue: '500万元' });
  });

  it('终局态（APPROVED/REJECTED）→ hasRound=false', async () => {
    for (const status of ['APPROVED', 'REJECTED', 'DISABLED', 'BLACKLIST']) {
      const { svc } = mkSvc({ ...SUP(), status });
      expect(await svc.getCorrectionDiff('sup-1')).toEqual({ hasRound: false });
    }
  });

  it('供应商不存在 → NotFoundException', async () => {
    const { svc } = mkSvc(null);
    await expect(svc.getCorrectionDiff('nope')).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm jest supplier-correction-diff --silent`
Expected: FAIL（getCorrectionDiff 不存在 / 快照缺新字段）

- [ ] **Step 3: 实现**

3a. `supplier.service.ts` `buildApprovalSnapshot` 返回对象中 `isTemporary: supplier.isTemporary,` 行之前插入：

```ts
      companyId: supplier.companyId,
      companyName: supplier.companyName,
      establishedDate: supplier.establishedDate ? supplier.establishedDate.toISOString().slice(0, 10) : null,
      companyProfile: supplier.companyProfile,
```

3b. `getApprovalHistory` 方法（:1993）之后新增：

```ts
  /** 补正变更清单（2026-11-24 spec）：退回时点快照 vs 当前申请自动比对。
   *  展示条件=存在 RETURNED 留痕且 status∈{RETURNED,PENDING}（注册流程未终局，三级续审人人可看）；
   *  退回原因取留痕记录 reason（权威）——Supplier.returnReason 列会被缺陷 approve 清空。 */
  async getCorrectionDiff(supplierId: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, status: true },
    });
    if (!supplier) throw new NotFoundException('供应商不存在');
    if (!['RETURNED', 'PENDING'].includes(supplier.status)) return { hasRound: false };
    const lastReturned = await this.prisma.supplierApprovalRecord.findFirst({
      where: { supplierId, action: 'RETURNED' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, reason: true, snapshot: true },
    });
    if (!lastReturned) return { hasRound: false };
    return {
      hasRound: true,
      returnedAt: lastReturned.createdAt.toISOString(),
      returnReason: lastReturned.reason ?? null,
      sections: buildCorrectionDiff(lastReturned.snapshot as Record<string, unknown>, await this.buildApprovalSnapshot(supplierId) as Record<string, unknown>),
    };
  }
```

并在 `supplier.service.ts` 顶部 import 区补 `import { buildCorrectionDiff } from './correction-diff.util';`（确认 `NotFoundException` 已在既有 import 中——文件已用 `NotFoundException('供应商不存在')` 于 `restoreStatus`，无需新增）。

3c. `supplier.controller.ts` `getApprovalHistory` 块（:163-169）之后新增：

```ts
  @Get(':id/correction-diff')
  @Roles('admin', 'leader', 'staff') // 补正变更清单：审批读口径，同 :id/approval-history
  async getCorrectionDiff(@Param('id') id: string) {
    return this.supplierService.getCorrectionDiff(id);
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm jest supplier-correction-diff --silent`
Expected: PASS（6 用例全绿）

- [ ] **Step 5: 供应商域回归（改共享服务必跑全域，memory supplier-domain-test-scope）**

Run: `pnpm jest src/supplier --silent`
Expected: 全绿（存量套件不被快照新增字段破坏——快照消费方按键取值，新增键向后兼容）

- [ ] **Step 6: 提交**

```bash
git -C /Users/qihao/ERP2/ERP add water-erp/apps/api/src/supplier/supplier.service.ts water-erp/apps/api/src/supplier/supplier.controller.ts water-erp/apps/api/src/supplier/supplier-correction-diff.spec.ts
git -C /Users/qihao/ERP2/ERP commit -m "feat(supplier): 补正变更清单端点 GET /supplier/:id/correction-diff——RETURNED/PENDING 周期内即时比对不落库；快照补 companyId/companyName/establishedDate/companyProfile 四字段

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: web API 客户端 + CorrectionDiffList 组件 + 详情页接入

**Files:**
- Modify: `apps/web/src/lib/api/supplier.ts`（`getApprovalHistory` :550 之后追加）
- Create: `apps/web/src/components/supplier/correction-diff-list.tsx`
- Modify: `apps/web/src/app/(main)/supplier/[id]/page.tsx`（import / state / loadAll / hero 后渲染）

**Interfaces:**
- Consumes: Task 2 端点响应形状 `{ hasRound, returnedAt?, returnReason?, sections? }`
- Produces: `getCorrectionDiff(id)`、类型 `CorrectionDiffItem/CorrectionDiffSection/CorrectionDiffResult`、组件 `CorrectionDiffList({ diff }: { diff: CorrectionDiffResult | null })`（hasRound=false 或无变化项时渲染 null）——Task 4 弹窗复用

- [ ] **Step 1: API 客户端**（`apps/web/src/lib/api/supplier.ts`，紧跟 `getApprovalHistory` 之后）

```ts
/** 补正变更清单（2026-11-24）：退回时点快照 vs 当前申请自动比对（两侧即掩码口径） */
export interface CorrectionDiffItem {
  kind: 'modified' | 'added' | 'removed';
  rowLabel: string;
  fieldLabel?: string;
  oldValue?: string;
  newValue?: string;
  fileReplaced?: boolean;
}
export interface CorrectionDiffSection {
  key: 'main' | 'account' | 'contacts' | 'qualifications' | 'bankAccounts' | 'performances';
  label: string;
  items: CorrectionDiffItem[];
}
export interface CorrectionDiffResult {
  hasRound: boolean;
  returnedAt?: string;
  returnReason?: string | null;
  sections?: CorrectionDiffSection[];
}
export function getCorrectionDiff(id: string) {
  return api.get<CorrectionDiffResult>(`/supplier/${id}/correction-diff`);
}
```

- [ ] **Step 2: 共享组件** `apps/web/src/components/supplier/correction-diff-list.tsx`

```tsx
import type { CorrectionDiffResult, CorrectionDiffSection } from '@/lib/api/supplier';

const KIND_META: Record<string, { text: string; cls: string }> = {
  added: { text: '新增', cls: 'text-[var(--success)]' },
  removed: { text: '移除', cls: 'text-[var(--danger)]' },
};

function DiffRows({ section }: { section: CorrectionDiffSection }) {
  return (
    <div className="flex flex-col">
      {section.items.map((it, i) => (
        <div key={i} className="flex flex-wrap items-baseline gap-x-2 border-b border-[color-mix(in_oklch,var(--muted-foreground)_12%,transparent)] py-1.5 text-xs last:border-b-0">
          {it.kind === 'modified' ? (
            <>
              <span className="font-medium text-[var(--foreground)]">{it.rowLabel}{it.fieldLabel ? `·${it.fieldLabel}` : ''}</span>
              {it.fileReplaced ? (
                <span className="rounded-full bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] px-1.5 py-px text-[10px] font-bold text-[var(--warning)]">文件已更换</span>
              ) : (
                <>
                  <span className="text-[var(--muted-foreground)] line-through">{it.oldValue}</span>
                  <span className="text-[var(--accent)]">→</span>
                  <span className="font-semibold text-[var(--foreground)]">{it.newValue}</span>
                </>
              )}
            </>
          ) : (
            <>
              <span className={`rounded-full px-1.5 py-px text-[10px] font-bold ${KIND_META[it.kind]?.cls ?? ''}`}
                style={{ background: 'color-mix(in oklch, currentColor 12%, transparent)' }}>{KIND_META[it.kind]?.text}</span>
              <span className="font-medium text-[var(--foreground)]">{it.rowLabel}</span>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/** 补正变更清单行区（2026-11-24）：无本轮/无变化项渲染 null；外层容器由调用面自定 */
export function CorrectionDiffList({ diff }: { diff: CorrectionDiffResult | null }) {
  const sections = (diff?.sections ?? []).filter((s) => s.items.length > 0);
  if (!diff?.hasRound || sections.length === 0) return null;
  return (
    <div className="flex flex-col gap-2.5">
      {sections.map((sec) => (
        <div key={sec.key}>
          <div className="mb-1 text-[11px] font-bold text-[var(--muted-foreground)]">{sec.label}</div>
          <DiffRows section={sec} />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: 详情页接入** `apps/web/src/app/(main)/supplier/[id]/page.tsx`

3a. import 区（`@/lib/api/supplier` 既有 import 合并追加）：`getCorrectionDiff` 与 `type CorrectionDiffResult`；组件 `import { CorrectionDiffList } from '@/components/supplier/correction-diff-list';`

3b. state（`const [supplier, setSupplier]` 附近）：

```tsx
const [correctionDiff, setCorrectionDiff] = useState<CorrectionDiffResult | null>(null);
```

3c. `loadAll`（:193-199 区域）Promise.all 追加第五项：

```tsx
const [s, q, e, c, d] = await Promise.all([
  getSupplier(id).catch(() => null),
  getQualifications(id).catch(() => []),
  getSupplierEvaluations(id).catch(() => []),
  getSupplierChanges(id).catch(() => []),
  getCorrectionDiff(id).catch(() => null),
]);
setSupplier(s);
setQualifications(q);
setEvaluations(e);
setChanges(c);
setCorrectionDiff(d);
setLoading(false);
```

3d. 渲染：hero 区块 `</div>`（:482）与 `{/* 信息分区切换 */}` 注释（:484）之间插入：

```tsx
{/* 本次补正变更（2026-11-24）：退回时点申请 vs 当前申请比对，仅补正周期内且有变化时显示 */}
{correctionDiff?.hasRound && (correctionDiff.sections ?? []).some((sec) => sec.items.length > 0) && (
  <details open className="neu-card mt-3 p-4">
    <summary className="cursor-pointer text-sm font-bold text-[var(--foreground)]">
      本次补正变更
      {correctionDiff.returnedAt && (
        <span className="ml-2 text-xs font-normal text-[var(--muted-foreground)]">退回于 {new Date(correctionDiff.returnedAt).toLocaleDateString('zh-CN')}</span>
      )}
      {correctionDiff.returnReason && (
        <span className="ml-2 text-xs font-normal text-[var(--warning)]">退回原因：{correctionDiff.returnReason}</span>
      )}
    </summary>
    <div className="mt-3">
      <CorrectionDiffList diff={correctionDiff} />
    </div>
  </details>
)}
```

- [ ] **Step 4: lint + 类型收口**

Run: `cd /Users/qihao/ERP2/ERP/water-erp && pnpm --filter web lint`
Expected: 0 error（注意 react-compiler 记忆化告警不新增——新组件无 hooks 前向引用）

- [ ] **Step 5: 提交**

```bash
git -C /Users/qihao/ERP2/ERP add water-erp/apps/web/src/lib/api/supplier.ts water-erp/apps/web/src/components/supplier/correction-diff-list.tsx "water-erp/apps/web/src/app/(main)/supplier/[id]/page.tsx"
git -C /Users/qihao/ERP2/ERP commit -m "feat(web): 供应商详情页「本次补正变更」区块——旧值→新值逐行对照，新增/移除/文件更换徽标

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: 审批中心弹窗接入

**Files:**
- Modify: `apps/web/src/components/supplier/review-center-modal.tsx`（import :21-27 / state / 选中 effect :543-562 / 渲染 :811-812 之间）

**Interfaces:**
- Consumes: Task 3 `getCorrectionDiff` / `CorrectionDiffList` / `CorrectionDiffResult`

- [ ] **Step 1: import 合并**（:21-27 既有 import 追加 `getCorrectionDiff`、`type CorrectionDiffResult`；新增 `import { CorrectionDiffList } from './correction-diff-list';`）

- [ ] **Step 2: state + effect**。`const [selected, setSelected] = useState<Supplier | null>(null);`（:477）附近加：

```tsx
const [correctionDiff, setCorrectionDiff] = useState<CorrectionDiffResult | null>(null);
```

选中 effect（:543-562，已有 `eslint-disable react-hooks/set-state-in-effect` 区间内）三处：

```tsx
if (!selected) { setHistory(null); setFull(null); setReason(''); setAttachments({}); setCorrectionDiff(null); return; }
setHistory(null);
setFull(null);
setAttachments({});
setCorrectionDiff(null);
```

effect 末尾（`getSupplier(selected.id).then(setFull).catch(...)` 之后）：

```tsx
getCorrectionDiff(selected.id).then(setCorrectionDiff).catch(() => setCorrectionDiff(null));
```

- [ ] **Step 3: 渲染**。审核进度 rc-section 收尾 `</div>`（:811）与 `{/* 分段二～N */}` 注释之间插入：

```tsx
{/* 分段一·补：本次补正变更（2026-11-24）——仅补正周期内且有变化时显示 */}
{correctionDiff?.hasRound && (correctionDiff.sections ?? []).some((sec) => sec.items.length > 0) && (
  <div className="rc-section">
    <div className="rc-section-label">本次补正变更</div>
    <CorrectionDiffList diff={correctionDiff} />
  </div>
)}
```

- [ ] **Step 4: lint 收口**

Run: `cd /Users/qihao/ERP2/ERP/water-erp && pnpm --filter web lint`
Expected: 0 error（setDiff 落在既有 eslint-disable 区间，无新增告警）

- [ ] **Step 5: 提交**

```bash
git -C /Users/qihao/ERP2/ERP add water-erp/apps/web/src/components/supplier/review-center-modal.tsx
git -C /Users/qihao/ERP2/ERP commit -m "feat(web): 审批中心弹窗「本次补正变更」区块——审核进度与申请资料之间同款展示

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: 全量验证 + dev 实弹

**Files:**
- Create (临时,验证后删): `apps/api/scripts/verify-correction-diff-repro.ts`

- [ ] **Step 1: API 全量单测 + lint**

```bash
cd /Users/qihao/ERP2/ERP/water-erp && pnpm --filter api test --silent && pnpm --filter api lint
```
Expected: 全绿 0 error

- [ ] **Step 2: web lint（两文件改动后整体复跑）**

```bash
pnpm --filter web lint
```

- [ ] **Step 3: dev 实弹（tsx 直调 service 走真库，免登录不踢会话）**

`apps/api/scripts/verify-correction-diff-repro.ts`：

```ts
/** 一次性验证（跑完即删）：取 dev 库一条 RETURNED 供应商，构造「退回时点快照」+ 置 PENDING，
 *  直调 getCorrectionDiff 打印变更清单，随后清理验证件恢复原状。 */
import { PrismaClient } from '@prisma/client';
import { SupplierService } from '../src/supplier/supplier.service';

const prisma = new PrismaClient();
const MARK = '注册资金与归属公司需修正（验证件）';

async function main() {
  const sup = await prisma.supplier.findFirst({ where: { status: 'RETURNED' }, select: { id: true, name: true, supplierNo: true } });
  if (!sup) throw new Error('dev 库无 RETURNED 供应商');
  const svc = new (SupplierService as any)(prisma, {}, null, null, null, null);
  const snap = await svc.buildApprovalSnapshot(sup.id);
  await prisma.supplierApprovalRecord.create({
    data: { supplierId: sup.id, action: 'RETURNED', stage: 'STAFF', reason: MARK, attachmentIds: [],
      snapshot: { ...snap, registeredCapital: '100万元', companyId: null, companyName: null } },
  });
  await prisma.supplier.update({ where: { id: sup.id }, data: { status: 'PENDING' } });
  const diff = await svc.getCorrectionDiff(sup.id);
  console.log(JSON.stringify(diff, null, 2));
  if (!diff.hasRound || !(diff.sections ?? []).length) throw new Error('实弹未产出变更清单');
  await prisma.supplierApprovalRecord.deleteMany({ where: { supplierId: sup.id, reason: MARK } });
  await prisma.supplier.update({ where: { id: sup.id }, data: { status: 'RETURNED' } });
  console.log(`OK ${sup.supplierNo} ${sup.name}：清单非空，验证件已清理`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
```

Run: `cd /Users/qihao/ERP2/ERP/water-erp/apps/api && npx tsx scripts/verify-correction-diff-repro.ts`
Expected: 打印 hasRound=true，main 节含 注册资金（万元）100万元→实值 与 归属公司 —→实值 两项；结尾 OK。

（若 `import { SupplierService }` 因模块副作用在 tsx 下报错：改跑 `pnpm --filter api test -- supplier-correction-diff` 确认单测绿，实弹验证降级为用户在 dev UI 自查——dev :3005 打开一条补正重提件核对区块渲染。）

- [ ] **Step 4: 删除临时脚本并提交收尾**

```bash
rm /Users/qihao/ERP2/ERP/water-erp/apps/api/scripts/verify-correction-diff-repro.ts
git -C /Users/qihao/ERP2/ERP status --short   # 确认仅预期改动
```

---

## Self-Review 记录

- **Spec coverage**：§2 触发口径→Task 2 `getCorrectionDiff` 状态闸；§3.1 diff 工具→Task 1；§3.2 快照补字段→Task 2（+companyProfile 扩充已注明）；§3.3 端点→Task 2；§4 两处展示→Task 3/4；§5 边界→旧快照缺键跳过（Task 1 用例2）+ RETURNED 未重提 sections=[]（Task 2 用例3）；§6 测试→Task 1/2 用例 + Task 5 全量。§7 不在范围未越界。✓
- **Placeholder scan**：全部步骤含实际代码/命令，无 TBD。✓
- **Type consistency**：`CorrectionDiffItem/Section` 三处（util/API client/组件）字段名一致；`getCorrectionDiff` 签名 Task 2 产出与 Task 3 消费一致；`buildCorrectionDiff(Snap, Snap)` 签名 Task 1 产出与 Task 2 调用一致。✓
