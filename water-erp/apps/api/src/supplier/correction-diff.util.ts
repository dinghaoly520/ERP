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
  const ao = o.account as Row | undefined;
  if (!ao) return null; // 旧快照缺 account 键跳过
  const an = n.account as Row | undefined;
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
