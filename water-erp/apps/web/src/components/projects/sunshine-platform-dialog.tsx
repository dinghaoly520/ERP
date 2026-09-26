'use client';

/**
 * 阳光采购平台发布配置（2026-09-24）
 *
 * 公告发布向导「发布范围」的附加选项（与 全部可见/部分供应商可见 不互斥）：
 * 勾选后向「天府阳光采购平台」同步推送公告数据。配置字段按
 * 《天府阳光采购平台招标数据接口文档 V2.0.5》设计：
 *   - 所有公告共用：SCM0001 招标基础信息（平台侧先有计划，公告数据才能导入——文档 status=4）
 *   - 采购公告 procurement_document → SCM0002 招标公告信息
 *   - 中标公告 winning_bid         → SCM0004 中标公示信息
 *   - 流标公告 failed_bid          → SCM0006 终止招标信息
 * 配置随公告发布快照写入 Announcement.metadata.sunshinePublish，供后端推送链路消费
 * （推送需平台方分配 identity + IP 白名单，接入前配置仅落档不外发）。
 */

import { useEffect, useMemo, useState } from 'react';
import { CloudUpload, X, FileText, Building2, ClipboardCheck, Trophy, Ban } from 'lucide-react';
import type { AnnouncementCategory, AnnouncementDraft } from '@/lib/types/announcement';
import type { ProjectManagementItem } from '@/lib/types/project-management';

/* ── 接口枚举映射（文档 byte 码值） ── */

/** SCM0001.proctype 招标方式（文档值域，集团采购方式名→码） */
const PROCTYPE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: '1-公开招标' },
  { value: 2, label: '2-邀请招标' },
  { value: 3, label: '3-竞争性谈判' },
  { value: 4, label: '4-询价采购' },
  { value: 5, label: '5-竞价采购' },
  { value: 6, label: '6-单一来源' },
  { value: 8, label: '8-竞争性磋商' },
  { value: 9, label: '9-公开比选' },
  { value: 21, label: '21-采购' },
  { value: 22, label: '22-竞价采购' },
  { value: 23, label: '23-询比采购' },
  { value: 24, label: '24-谈判采购' },
  { value: 25, label: '25-直接采购' },
];
const PROCTYPE_BY_METHOD: Record<string, number> = {
  公开招标: 1, 邀请招标: 2, 竞争性谈判: 3, 询价采购: 4,
  // 竞价采购取 22（V2.0.0 新增的 21-25 GB/T 43711 对齐段，与 23询比/24谈判/25直接同族；5 为旧码）
  竞价采购: 22,
  单一来源: 6, 竞争性磋商: 8, 公开比选: 9, 采购: 21, 询比采购: 23, 谈判采购: 24, 直接采购: 25,
};

/** SCM0001.type 招标计划类型（按项目采购类别推断默认值） */
const PLAN_TYPE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 2, label: '2-物资采购' },
  { value: 3, label: '3-劳务作业' },
  { value: 4, label: '4-专业作业' },
  { value: 5, label: '5-机械设备' },
  { value: 7, label: '7-综合服务' },
  { value: 10, label: '10-工程采购' },
  { value: 11, label: '11-物资采购' },
  { value: 12, label: '12-服务采购' },
];
/** 系统「采购类别」枚举（PROCUREMENT_CATEGORY_OPTIONS）→ type 码；泛词兜底防自建类别 */
const PLAN_TYPE_BY_CATEGORY: Record<string, number> = {
  生产技术类采购: 11, // 物资采购
  EPC项目采购: 10, // 工程采购
  EPC管理采购: 10, // 工程采购
  公用集中采购: 7, // 综合服务
  科技研发类采购: 7, // 综合服务
  信息化采购: 12, // 服务采购
  其他: 7,
  货物: 11, 物资: 11, 工程: 10, 服务: 12, 劳务: 3, // 兜底泛词
};

/** 各公告类型对应的平台接口（文档接口编码）——向导发布快照复用 */
export const SUNSHINE_CATEGORY_INTERFACE: Record<AnnouncementCategory, { code: string; name: string }> = {
  procurement_document: { code: 'SCM0002', name: '招标公告信息' },
  winning_bid: { code: 'SCM0004', name: '中标公示信息' },
  failed_bid: { code: 'SCM0006', name: '终止招标信息' },
};

export type SunshineCandidate = {
  packageName: string;
  packageUnique: string;
  supplierName: string;
  ranking: number;
  companyUnique: string;
  /** 万元（SCM0004.bidAmount） */
  bidAmount: number | null;
};

export type SunshinePublishConfig = {
  /* SCM0001 招标基础信息 */
  planCode: string;
  planName: string;
  projectCode: string;
  projectName: string;
  proctype: number;
  type: number;
  /** 万元 */
  tenderAmount: number | null;
  centralized: 0 | 1;
  handUserName: string;
  handOrganizationName: string;
  contacts: string;
  phone: string;
  email: string;
  organizationCode: string;
  organizationName: string;
  organizationUnique: string;
  parentOrganization: string;
  standardQuota: number | null;
  publicQuota: number | null;
  procuringentity: string;
  /** 单标包：标包名称 */
  packageName: string;
  /* 公告侧（按类型对应接口） */
  publishTime: string;
  deadline: string;
  annrequire: 0 | 1;
  annreason: string;
  startTime: string;
  endTime: string;
  issueUserName: string;
  content: string;
  candidates: SunshineCandidate[];
};

/** datetime-local（YYYY-MM-DDTHH:mm）→ 文档时间格式 yyyy-MM-dd HH:mm:ss */
function toApiTime(v: string): string {
  const m = v.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}:00` : v;
}

/** ISO 时间串 → 文档时间格式（本地时区）；非法输入回落当前时刻 */
function isoToApiTime(v?: string): string {
  if (!v) return toApiTime(daysFromNow(0));
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return toApiTime(daysFromNow(0));
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 今日 + n 天的 datetime-local 值 */
function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 打开弹窗时的全量预填：项目/草稿数据 → 接口字段 */
function buildDefaultConfig(
  project: ProjectManagementItem,
  draft: AnnouncementDraft,
  category: AnnouncementCategory,
  operatorName: string,
): SunshinePublishConfig {
  const d = draft as Record<string, string>;
  // 中标候选人：公告草稿 bidderN 行（评审报价元 → 万元）
  const candidates: SunshineCandidate[] = [];
  const count = parseInt(d.bidderCount || '0', 10) || 0;
  for (let i = 1; i <= Math.max(count, 0); i++) {
    const name = (d[`bidder${i}Name`] || '').trim();
    if (!name) continue;
    const priceYuan = parseFloat(d[`bidder${i}Price`] || '');
    candidates.push({
      packageName: project.title,
      packageUnique: project.projectCode || project.id,
      supplierName: name,
      ranking: i,
      companyUnique: '',
      bidAmount: Number.isFinite(priceYuan) ? +(priceYuan / 10000).toFixed(4) : null,
    });
  }
  const budgetYuan = project.budgetAmount != null ? Number(project.budgetAmount) : NaN;
  return {
    planCode: project.projectCode || '',
    planName: project.title,
    projectCode: project.projectCode || '',
    projectName: project.title,
    proctype: PROCTYPE_BY_METHOD[project.procurementMethod] ?? 21,
    type: PLAN_TYPE_BY_CATEGORY[project.procurementCategory ?? ''] ?? 7,
    tenderAmount: Number.isFinite(budgetYuan) ? +(budgetYuan / 10000).toFixed(4) : null,
    centralized: 1,
    handUserName: operatorName || project.requesterName || '',
    handOrganizationName: project.requesterDepartment || '',
    contacts: d.contactName || project.requesterName || '',
    phone: d.contactPhone || '',
    email: d.contactEmail || '',
    organizationCode: '',
    organizationName: project.requesterDepartment || '',
    organizationUnique: '',
    parentOrganization: '',
    standardQuota: null,
    publicQuota: null,
    procuringentity: '',
    packageName: project.title,
    // SCM0004/0006 的 publishTime 必传：中标/流标公告草稿无公示起字段，兜底当前时刻（发布时仍可改）
    publishTime: d.announcementStart || (category === 'procurement_document' ? '' : daysFromNow(0)),
    deadline: d.announcementEnd || '',
    annrequire: 1,
    annreason: '',
    startTime: daysFromNow(0),
    endTime: daysFromNow(3),
    issueUserName: operatorName || '',
    content: '',
    candidates,
  };
}

const inputCls =
  'w-full px-3 py-2 border border-[var(--border)] bg-[var(--background)] rounded-lg text-sm placeholder-[var(--muted-foreground)]/60 focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/10';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
        {label}
        {hint && <span className="ml-1 font-normal normal-case tracking-normal opacity-70">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function SectionCard({
  icon: Icon,
  title,
  tag,
  children,
}: {
  icon: typeof FileText;
  title: string;
  tag: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-[18px] p-4"
      style={{
        background: 'oklch(1 0 0 / 0.48)',
        boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 1px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.8)',
      }}
    >
      <div className="mb-3 flex items-center gap-2">
        <Icon size={15} className="text-[var(--accent)]" />
        <span className="text-[0.85rem] font-bold text-[var(--foreground)]">{title}</span>
        <span className="rounded-[6px] bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--accent)]">
          {tag}
        </span>
      </div>
      {children}
    </div>
  );
}

export function SunshinePlatformDialog({
  isOpen,
  onClose,
  onSave,
  category,
  project,
  draft,
  visibility,
  operatorName,
  initialConfig,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: SunshinePublishConfig) => void;
  category: AnnouncementCategory;
  project: ProjectManagementItem;
  draft: AnnouncementDraft;
  /** 发布范围决定 issueType（公开/邀请）与 isExternal（是否对外公开）——弹窗内只读展示 */
  visibility: 'PUBLIC' | 'RESTRICTED';
  operatorName?: string;
  initialConfig?: SunshinePublishConfig | null;
}) {
  const [config, setConfig] = useState<SunshinePublishConfig | null>(null);
  // 打开时一次性预填（已有配置则沿用，不重复覆盖用户改过的值）
  /* eslint-disable react-hooks/set-state-in-effect -- 弹窗打开时的表单初始化，符合模态惯例 */
  useEffect(() => {
    if (isOpen) {
      setConfig(initialConfig ?? buildDefaultConfig(project, draft, category, operatorName ?? ''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /** 推送报文预览（文档字段组织，供核对）——须在早退 return 之前调用（hooks 顺序稳定） */
  const iface = SUNSHINE_CATEGORY_INTERFACE[category];
  const payloadPreview = useMemo(() => {
    if (!config) return '';
    // identity 为各接口必传，由后端推送时按平台分配值注入——预览中占位明示
    const IDENTITY = '<平台分配，推送时注入>';
    const scm0001 = {
      identity: IDENTITY,
      unique: project.id,
      type: config.type,
      // phase 取推送后的落点状态：采购公告随发即「公告已发布(4)」；中标公示→「公示已发布(9)」；流标→「终止招标(-2)」
      phase: category === 'procurement_document' ? 4 : category === 'winning_bid' ? 9 : -2,
      proctype: config.proctype,
      issueType: visibility === 'PUBLIC' ? 1 : 2,
      isExternal: visibility === 'PUBLIC' ? 1 : 0,
      planCode: config.planCode,
      planName: config.planName,
      projectCode: config.projectCode,
      projectName: config.projectName,
      organizationCode: config.organizationCode,
      organizationName: config.organizationName,
      organizationUnique: config.organizationUnique,
      parentOrganization: config.parentOrganization,
      handUserName: config.handUserName,
      handOrganizationName: config.handOrganizationName,
      contacts: config.contacts,
      phone: config.phone,
      email: config.email,
      tenderAmount: config.tenderAmount,
      // 创建时间取项目立项时间（本地时区转文档格式），缺失回落当前时刻
      createTime: isoToApiTime(project.createdAt),
      centralized: config.centralized,
      procuringentity: config.procuringentity,
      standardQuota: config.standardQuota,
      publicQuota: config.publicQuota,
      tenderPackage: [{ unique: project.id, name: config.packageName }],
    };
    let announcement: Record<string, unknown> = {};
    if (category === 'procurement_document') {
      announcement = {
        identity: IDENTITY,
        unique: `${project.id}-ann`,
        planUnique: project.id,
        publishTime: toApiTime(config.publishTime),
        deadline: toApiTime(config.deadline),
        content: '(公告正文 HTML，随发布自动生成)',
        annrequire: config.annrequire,
        ...(config.annrequire === 0 && config.annreason ? { annreason: config.annreason } : {}),
      };
    } else if (category === 'winning_bid') {
      announcement = {
        identity: IDENTITY,
        unique: `${project.id}-publicity`,
        planUnique: project.id,
        publishTime: toApiTime(config.publishTime || config.startTime),
        issueUserName: config.issueUserName,
        content: config.content || '(公示内容，随公告正文)',
        startTime: toApiTime(config.startTime),
        endTime: toApiTime(config.endTime),
        // 是否对外发布公示：随公告范围（全部可见=对外）
        isPublicityPublish: visibility === 'PUBLIC' ? 1 : 0,
        pubequire: config.annrequire,
        ...(config.annrequire === 0 && config.annreason ? { pubreason: config.annreason } : {}),
        candidates: config.candidates.map((c) => ({
          packageName: c.packageName,
          packageUnique: c.packageUnique,
          supplierName: c.supplierName,
          ranking: c.ranking,
          companyUnique: c.companyUnique,
          bidAmount: c.bidAmount,
        })),
        // 文档 SCM0004 changes 变更集合标必传——首发无变更传空集合（联调时与平台确认空数组语义）
        changes: [],
      };
    } else {
      announcement = {
        identity: IDENTITY,
        unique: `${project.id}-termination`,
        planUnique: project.id,
        publishTime: toApiTime(config.publishTime || config.startTime),
        issueUserName: config.issueUserName,
        content: config.content || '(公示内容，随公告正文)',
        startTime: toApiTime(config.startTime),
        endTime: toApiTime(config.endTime),
      };
    }
    return JSON.stringify({ 'SCM0001 招标基础信息': scm0001, [`${iface.code} ${iface.name}`]: announcement }, null, 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, category, visibility, project.id]);

  if (!isOpen || !config) return null;

  const set = <K extends keyof SunshinePublishConfig>(key: K, value: SunshinePublishConfig[K]) =>
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev));

  /* 必传要素自检（文档「必传=是」且不由系统自动携带的字段）——当前为测试阶段不外发，
     此清单回答「要素是否齐全」：接入真实推送前按此补全即可通过平台侧校验 */
  const missingFields: string[] = [];
  const reqText = (label: string, v: string) => { if (!v.trim()) missingFields.push(label); };
  const reqNum = (label: string, v: number | null) => { if (v == null) missingFields.push(label); };
  reqText('招标计划编码', config.planCode);
  reqText('招标计划名称', config.planName);
  reqText('项目编码', config.projectCode);
  reqText('项目名称', config.projectName);
  reqText('组织编码', config.organizationCode);
  reqText('组织名称', config.organizationName);
  reqText('组织唯一标识', config.organizationUnique);
  reqText('父级组织', config.parentOrganization);
  reqText('招标经办人', config.handUserName);
  reqText('招标组织名称', config.handOrganizationName);
  reqText('联系人', config.contacts);
  reqText('联系电话', config.phone);
  reqText('邮箱', config.email);
  reqNum('招标金额(万元)', config.tenderAmount);
  reqNum('招标采购限额(万元)', config.standardQuota);
  reqNum('公开采购限额(万元)', config.publicQuota);
  reqText('采购主体id', config.procuringentity);
  reqText('标包名称', config.packageName);
  if (category === 'procurement_document') {
    reqText('公告发布时间', config.publishTime);
    reqText('公告截止时间', config.deadline);
  } else {
    reqText('公示发布时间', config.publishTime);
    reqText('发布人', config.issueUserName);
    reqText('公示期起', config.startTime);
    reqText('公示期止', config.endTime);
    if (category === 'winning_bid') {
      if (config.candidates.length === 0) missingFields.push('中标候选单位');
      // 候选单位子字段：supplierName/companyUnique/bidAmount 文档均标必传
      config.candidates.forEach((c, i) => {
        if (!c.supplierName.trim()) missingFields.push(`候选单位${i + 1}名称`);
        if (!c.companyUnique.trim()) missingFields.push(`候选单位${i + 1}供应商标识`);
        if (c.bidAmount == null) missingFields.push(`候选单位${i + 1}投标金额`);
      });
    }
  }

  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center">
      <div
        className="absolute inset-0"
        style={{ background: 'oklch(0.1 0.02 258 / 0.42)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />
      <div
        className="relative z-10 flex max-h-[86vh] w-full max-w-[720px] flex-col overflow-hidden rounded-[24px]"
        style={{
          background: 'linear-gradient(170deg, oklch(1 0 0 / 0.97), oklch(0.99 0.003 258 / 0.72))',
          boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.9), 4px 5px 18px oklch(0.45 0.07 258 / 0.2), -2px -2px 8px oklch(1 0 0 / 0.9)',
        }}
      >
        {/* 标题 */}
        <div className="flex shrink-0 items-center justify-between gap-3 px-6 py-4" style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.14)' }}>
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]"
              style={{ background: 'color-mix(in oklch, var(--accent-soft) 45%, transparent)' }}
            >
              <CloudUpload size={17} className="text-[var(--accent)]" />
            </div>
            <div className="min-w-0">
              <div className="text-[0.92rem] font-semibold text-[var(--foreground)]">阳光采购平台发布配置</div>
              <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)]">
                天府阳光采购平台 · 接口文档 V2.0.5 · 本公告走 {iface.code} {iface.name}（前置推送 SCM0001 招标基础信息）
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="neu-btn-xs"><X size={16} /></button>
        </div>

        {/* 内容 */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
            以下字段已按项目与公告草稿预填，请核对补全后保存。组织编码/唯一标识、采购主体 id 等平台侧档案字段如暂无，可联系阳光采购服务团队获取后补填；
            推送需平台分配 identity 身份标识并加 IP 白名单，接入完成前本配置仅随公告存档、不实际外发。
          </p>

          {/* SCM0001 基础信息 */}
          <SectionCard icon={Building2} title="招标基础信息" tag="SCM0001">
            <div className="grid grid-cols-2 gap-3">
              <Field label="招标计划编码 planCode"><input className={inputCls} value={config.planCode} onChange={(e) => set('planCode', e.target.value)} /></Field>
              <Field label="招标计划名称 planName"><input className={inputCls} value={config.planName} onChange={(e) => set('planName', e.target.value)} /></Field>
              <Field label="项目编码 projectCode"><input className={inputCls} value={config.projectCode} onChange={(e) => set('projectCode', e.target.value)} /></Field>
              <Field label="项目名称 projectName"><input className={inputCls} value={config.projectName} onChange={(e) => set('projectName', e.target.value)} /></Field>
              <Field label="招标方式 proctype">
                <select className={inputCls} value={config.proctype} onChange={(e) => set('proctype', Number(e.target.value))}>
                  {PROCTYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="招标计划类型 type">
                <select className={inputCls} value={config.type} onChange={(e) => set('type', Number(e.target.value))}>
                  {PLAN_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="招标金额(万元) tenderAmount"><input type="number" step="0.0001" className={inputCls} value={config.tenderAmount ?? ''} onChange={(e) => set('tenderAmount', e.target.value === '' ? null : Number(e.target.value))} /></Field>
              <Field label="标包名称 tenderPackage.name" hint="单标包填计划名称">
                <input className={inputCls} value={config.packageName} onChange={(e) => set('packageName', e.target.value)} />
              </Field>
              <Field label="组织编码 organizationCode"><input className={inputCls} value={config.organizationCode} onChange={(e) => set('organizationCode', e.target.value)} /></Field>
              <Field label="组织名称 organizationName"><input className={inputCls} value={config.organizationName} onChange={(e) => set('organizationName', e.target.value)} /></Field>
              <Field label="组织唯一标识 organizationUnique"><input className={inputCls} value={config.organizationUnique} onChange={(e) => set('organizationUnique', e.target.value)} /></Field>
              <Field label="父级组织 parentOrganization" hint="唯一标识用/分割到根">
                <input className={inputCls} value={config.parentOrganization} onChange={(e) => set('parentOrganization', e.target.value)} />
              </Field>
              <Field label="招标经办人 handUserName"><input className={inputCls} value={config.handUserName} onChange={(e) => set('handUserName', e.target.value)} /></Field>
              <Field label="招标组织名称 handOrganizationName"><input className={inputCls} value={config.handOrganizationName} onChange={(e) => set('handOrganizationName', e.target.value)} /></Field>
              <Field label="采购主体id procuringentity" hint="SCM0010 查询"><input className={inputCls} value={config.procuringentity} onChange={(e) => set('procuringentity', e.target.value)} /></Field>
              <Field label="是否集中采购 centralized">
                <select className={inputCls} value={config.centralized} onChange={(e) => set('centralized', Number(e.target.value) as 0 | 1)}>
                  <option value={1}>1-是</option>
                  <option value={0}>0-否</option>
                </select>
              </Field>
              <Field label="招标采购限额(万元) standardQuota"><input type="number" step="0.0001" className={inputCls} value={config.standardQuota ?? ''} onChange={(e) => set('standardQuota', e.target.value === '' ? null : Number(e.target.value))} /></Field>
              <Field label="公开采购限额(万元) publicQuota"><input type="number" step="0.0001" className={inputCls} value={config.publicQuota ?? ''} onChange={(e) => set('publicQuota', e.target.value === '' ? null : Number(e.target.value))} /></Field>
              <Field label="联系人 contacts"><input className={inputCls} value={config.contacts} onChange={(e) => set('contacts', e.target.value)} /></Field>
              <Field label="联系电话 phone"><input className={inputCls} value={config.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
              <Field label="邮箱 email"><input className={inputCls} value={config.email} onChange={(e) => set('email', e.target.value)} /></Field>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 rounded-lg bg-[color-mix(in_oklch,var(--accent)_5%,transparent)] px-3 py-2 text-[11px] text-[var(--muted-foreground)]">
              <span>发布方式 issueType：<b className="text-[var(--foreground)]">{visibility === 'PUBLIC' ? '1-公开方式' : '2-邀请方式'}</b>（随公告范围）</span>
              <span>是否对外公开 isExternal：<b className="text-[var(--foreground)]">{visibility === 'PUBLIC' ? '1-是' : '0-否'}</b></span>
            </div>
          </SectionCard>

          {/* 按公告类型的接口区块 */}
          {category === 'procurement_document' && (
            <SectionCard icon={ClipboardCheck} title="招标公告信息" tag="SCM0002">
              <div className="grid grid-cols-2 gap-3">
                <Field label="公告发布时间 publishTime"><input type="datetime-local" className={inputCls} value={config.publishTime} onChange={(e) => set('publishTime', e.target.value)} /></Field>
                <Field label="公告截止时间 deadline"><input type="datetime-local" className={inputCls} value={config.deadline} onChange={(e) => set('deadline', e.target.value)} /></Field>
                <Field label="发售期满足川国资委〔2025〕51号文 annrequire">
                  <select className={inputCls} value={config.annrequire} onChange={(e) => set('annrequire', Number(e.target.value) as 0 | 1)}>
                    <option value={1}>1-是</option>
                    <option value={0}>0-否</option>
                  </select>
                </Field>
                {config.annrequire === 0 && (
                  <Field label="不满足原因 annreason"><input className={inputCls} value={config.annreason} onChange={(e) => set('annreason', e.target.value)} placeholder="发售期不满足要求原因" /></Field>
                )}
              </div>
              <p className="mt-2 text-[10px] text-[var(--muted-foreground)]">公告正文 content（HTML）与附件地址 attachment 将在发布时由系统自动携带，无需填写。</p>
            </SectionCard>
          )}

          {category === 'winning_bid' && (
            <SectionCard icon={Trophy} title="中标公示信息" tag="SCM0004">
              <div className="grid grid-cols-2 gap-3">
                <Field label="公示发布时间 publishTime"><input type="datetime-local" className={inputCls} value={config.publishTime} onChange={(e) => set('publishTime', e.target.value)} /></Field>
                <Field label="发布人 issueUserName"><input className={inputCls} value={config.issueUserName} onChange={(e) => set('issueUserName', e.target.value)} /></Field>
                <Field label="公示期起 startTime"><input type="datetime-local" className={inputCls} value={config.startTime} onChange={(e) => set('startTime', e.target.value)} /></Field>
                <Field label="公示期止 endTime"><input type="datetime-local" className={inputCls} value={config.endTime} onChange={(e) => set('endTime', e.target.value)} /></Field>
                <Field label="公示期满足51号文 pubequire">
                  <select className={inputCls} value={config.annrequire} onChange={(e) => set('annrequire', Number(e.target.value) as 0 | 1)}>
                    <option value={1}>1-是</option>
                    <option value={0}>0-否</option>
                  </select>
                </Field>
                {config.annrequire === 0 && (
                  <Field label="不满足原因 pubreason"><input className={inputCls} value={config.annreason} onChange={(e) => set('annreason', e.target.value)} /></Field>
                )}
              </div>
              {/* 候选人（公告草稿 bidder 行预填，可增删改） */}
              <div className="mt-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">中标候选单位 candidates（名次 ranking 为 0 时门户不显示）</span>
                  <button type="button" className="neu-btn-xs" onClick={() => setConfig((prev) => prev ? { ...prev, candidates: [...prev.candidates, { packageName: prev.packageName, packageUnique: project.projectCode || project.id, supplierName: '', ranking: prev.candidates.length + 1, companyUnique: '', bidAmount: null }] } : prev)}>添加</button>
                </div>
                <div className="space-y-2">
                  {config.candidates.map((c, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input type="number" className={`${inputCls} w-16 shrink-0 text-center`} value={c.ranking} title="候选名次 ranking" onChange={(e) => setConfig((prev) => prev ? { ...prev, candidates: prev.candidates.map((x, j) => j === i ? { ...x, ranking: Number(e.target.value) } : x) } : prev)} />
                      <input className={`${inputCls} flex-1`} placeholder="公司名称 supplierName" value={c.supplierName} onChange={(e) => setConfig((prev) => prev ? { ...prev, candidates: prev.candidates.map((x, j) => j === i ? { ...x, supplierName: e.target.value } : x) } : prev)} />
                      <input type="number" step="0.0001" className={`${inputCls} w-28 shrink-0`} placeholder="投标金额(万元)" value={c.bidAmount ?? ''} onChange={(e) => setConfig((prev) => prev ? { ...prev, candidates: prev.candidates.map((x, j) => j === i ? { ...x, bidAmount: e.target.value === '' ? null : Number(e.target.value) } : x) } : prev)} />
                      <input className={`${inputCls} w-36 shrink-0`} placeholder="供应商唯一标识" value={c.companyUnique} onChange={(e) => setConfig((prev) => prev ? { ...prev, candidates: prev.candidates.map((x, j) => j === i ? { ...x, companyUnique: e.target.value } : x) } : prev)} />
                      <button type="button" className="neu-btn-xs is-danger shrink-0" onClick={() => setConfig((prev) => prev ? { ...prev, candidates: prev.candidates.filter((_, j) => j !== i) } : prev)}><X size={13} /></button>
                    </div>
                  ))}
                  {config.candidates.length === 0 && <p className="py-2 text-center text-[11px] text-[var(--muted-foreground)]">公告草稿中暂无投标单位，可点击「添加」手动录入候选单位</p>}
                </div>
              </div>
              <Field label="公示内容 content">
                <textarea className={`${inputCls} mt-1 min-h-[72px]`} value={config.content} onChange={(e) => set('content', e.target.value)} placeholder="留空则随公告正文自动生成" />
              </Field>
            </SectionCard>
          )}

          {category === 'failed_bid' && (
            <SectionCard icon={Ban} title="终止招标信息" tag="SCM0006">
              <div className="grid grid-cols-2 gap-3">
                <Field label="公示发布时间 publishTime"><input type="datetime-local" className={inputCls} value={config.publishTime} onChange={(e) => set('publishTime', e.target.value)} /></Field>
                <Field label="发布人 issueUserName"><input className={inputCls} value={config.issueUserName} onChange={(e) => set('issueUserName', e.target.value)} /></Field>
                <Field label="公示期起 startTime"><input type="datetime-local" className={inputCls} value={config.startTime} onChange={(e) => set('startTime', e.target.value)} /></Field>
                <Field label="公示期止 endTime"><input type="datetime-local" className={inputCls} value={config.endTime} onChange={(e) => set('endTime', e.target.value)} /></Field>
              </div>
              <Field label="公示内容 content">
                <textarea maxLength={2000} className={`${inputCls} mt-1 min-h-[72px]`} value={config.content} onChange={(e) => set('content', e.target.value)} placeholder="留空则随公告正文自动生成（文档限长 2000 字）" />
              </Field>
            </SectionCard>
          )}

          {/* 必传要素自检：接入真实推送前需补全（当前仅存档不外发） */}
          <div
            className={`rounded-[12px] px-4 py-2.5 text-xs font-semibold leading-5 ${
              missingFields.length
                ? 'bg-[color-mix(in_oklch,var(--warning)_10%,transparent)] text-[var(--warning)]'
                : 'bg-[color-mix(in_oklch,var(--success)_10%,transparent)] text-[var(--success)]'
            }`}
          >
            {missingFields.length
              ? `要素待补全 ${missingFields.length} 项（接口必传字段，接入推送前需补全）：${missingFields.join('、')}`
              : '接口必传要素已齐全 ✓（当前为测试存档，未向阳光采购平台发送任何数据）'}
          </div>

          {/* 报文预览 */}
          <details className="rounded-[14px] bg-[oklch(1_0_0_/_0.4)] px-4 py-3">
            <summary className="cursor-pointer text-xs font-bold text-[var(--foreground)]">推送报文预览（按接口文档字段组织）</summary>
            <pre className="mt-2 max-h-[240px] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[oklch(0.97_0.005_258)] p-3 text-[10px] leading-4 text-[var(--foreground)]">{payloadPreview}</pre>
          </details>
        </div>

        {/* 底栏 */}
        <div className="flex shrink-0 items-center justify-end gap-3 px-6 py-3.5" style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.14)' }}>
          <button type="button" onClick={onClose} className="neu-btn-soft">取消</button>
          <button
            type="button"
            onClick={() => { onSave(config); onClose(); }}
            className="neu-btn-primary !h-[38px]"
          >
            <CloudUpload size={14} /> 保存配置
          </button>
        </div>
      </div>
    </div>
  );
}
