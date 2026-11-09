'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { resolveNotificationLink, openNotificationLink } from '@/lib/notification-link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { getNotificationMeta, getNotificationLabel } from '@water-erp/shared';
import {
  listNotifications, markNotificationRead, markAllNotificationsRead, fetchMyActivities, fetchAllActivities, resolveNotification,
  type NotificationItem, type NotificationTab, type AuditActivity,
} from '@/lib/api/notification';
import {
  fetchPendingProfileChanges, approveProfileChange, rejectProfileChange,
  fetchPendingRegistrations, approveRegistration, rejectRegistration,
  fetchCurrentUser,
} from '@/lib/api/auth';
import { getSupplier, getSupplierList, approveSupplier, rejectSupplier, returnSupplier } from '@/lib/api/supplier';
import { Modal } from '@/components/workbench';
import {
  Bell, CheckCheck, Clock, History, Inbox, ClipboardList, CircleCheck, BookOpen, Loader2, CheckCircle2, XCircle, RotateCcw, UserPlus, IdCard,
  ChevronLeft, ChevronRight, Download,
} from 'lucide-react';
import { downloadHistoryTxt } from '@/lib/history-export';

/* ════════════════════════════════════════════════════════════════
 * 通知中心（2026-09-26 五段状态重构）
 *
 * 顶部分段：全部 / 待办 / 已办 / 待阅 / 已阅
 *  - 待办/已办 = 可操作类型（注册表 actionable）；resolvedAt 分界（已读兜底归已办）
 *  - 待阅/已阅 = 知会类型；isRead 分界，已阅带查阅时间 readAt
 * 不聚合：每条平铺，按时间倒序。待办/待阅行淡红、已办/已阅行灰。
 * 操作：
 *  - 待办「处理」→ 处理窗（窗内直接审批：资料变更/注册审核/供应商注册）
 *  - 已办「查看」→ 查看窗（全文 + 处理时间 + 操作结果记录）
 *  - 待阅/已阅「查看」→ 查看窗（全文；已阅显示查阅时间）
 * 标题栏右上角「操作历史」= 当前用户 AuditLog 时间线。
 * ════════════════════════════════════════════════════════════════ */

const PAGE_SIZE = 20;

/** 条目状态（与后端 list 五段口径一致） */
function itemState(n: NotificationItem): 'todo' | 'done' | 'toread' | 'read' {
  const actionable = getNotificationMeta(n.type).actionable;
  if (actionable) return (n.resolvedAt || n.isRead) ? 'done' : 'todo';
  return n.isRead ? 'read' : 'toread';
}

const SEGMENT: { key: NotificationTab; label: string; icon: any }[] = [
  { key: 'all', label: '全部', icon: Inbox },
  { key: 'todo', label: '待办', icon: ClipboardList },
  { key: 'done', label: '已办', icon: CircleCheck },
  { key: 'toread', label: '待阅', icon: BookOpen },
  { key: 'read', label: '已阅', icon: CheckCheck },
];

/** 审计动作 → 中文（操作历史/已办结果展示）。未列入的会话类动作由 UI 过滤不展示。 */
const ACTION_LABEL: Record<string, string> = {
  // ── 账号与安全 ──
  PASSWORD_CHANGE_REQUEST: '申请修改密码',
  PASSWORD_CHANGE_APPROVED: '密码修改申请 · 通过',
  PASSWORD_CHANGE_REJECTED: '密码修改申请 · 拒绝',
  PASSWORD_RESET_REQUEST: '申请忘记密码重置',
  PASSWORD_RESET_APPROVED: '密码重置申请 · 通过',
  PASSWORD_RESET_REJECTED: '密码重置申请 · 拒绝',
  PROFILE_CHANGE_APPROVED: '资料变更审批 · 通过',
  PROFILE_CHANGE_REJECTED: '资料变更审批 · 拒绝',
  USER_REGISTRATION_APPROVED: '注册审核 · 通过',
  USER_REGISTRATION_REJECTED: '注册审核 · 拒绝',
  PROFILE_UPDATE: '更新个人资料',
  SETTINGS_UPDATE: '更新系统设置',
  // ── 供应商 ──
  SUPPLIER_APPROVED: '供应商审批 · 通过',
  SUPPLIER_REJECTED: '供应商审批 · 拒绝',
  SUPPLIER_RETURNED: '供应商审批 · 退回补正',
  SUPPLIER_BLACKLIST: '供应商列入黑名单',
  SUPPLIER_DISABLE: '供应商停用',
  SUPPLIER_ENABLE: '供应商恢复',
  SUPPLIER_UPDATE: '更新供应商资料',
  // ── 项目 ──
  PROJECT_CREATE: '创建采购项目',
  PROJECT_UPDATE: '更新采购项目',
  PROJECT_DELETE: '删除采购项目',
  PROJECT_STAGE_CHANGE: '项目阶段推进',
  PROJECT_ARCHIVE: '项目归档',
  // ── 公告 ──
  ANNOUNCEMENT_CREATE: '新建公告',
  ANNOUNCEMENT_PUBLISH: '发布公告',
  ANNOUNCEMENT_UPDATE: '更新公告',
  ANNOUNCEMENT_DELETE: '删除公告',
  // ── 开评标 ──
  BID_STAGE_CHANGE: '开标阶段流转',
  BID_PROJECT_ABORT: '项目流标',
  BID_OPENING_HANDOVER: '开标资料移交',
  BID_OPENING_SIGN_REGISTERED: '评标签字登记',
  BID_RESULTS_GENERATED: '生成评标结果',
  BID_DISPUTE_RESOLVE: '异议裁决',
  BID_CLARIFICATION_CREATE: '发起评标澄清',
  BID_NUDGE_SUPPLIERS: '催促供应商投标',
  BID_NUDGE_EXPERTS: '催促专家评审',
  BID_INVITE_SUPPLIERS: '邀请供应商',
  BID_DECRYPT: '标书解密',
  BID_DECRYPT_ADJUDGE: '解密异常裁决',
  EVALUATION_EXTEND: '延长评标时限',
  // ── 专家 ──
  EXPERT_EXTRACTION_CONFIRMED: '确认专家抽取',
  EXPERT_DISPUTE_RESOLVE: '专家异议处理',
  EXPERT_VIOLATION_RECORDED: '记录专家违规',
  DEMAND_REP_EXTERNAL_CREATE: '手动录入需求方代表',
  // ── 合同 ──
  CONTRACT_SIGNED: '合同签署',
  CONTRACT_TERMINATED: '合同终止',
  CONTRACT_ACCEPTED: '合同验收',
  CONTRACT_FULFILLMENT_ADDED: '登记合同履约节点',
  CONTRACT_FULFILLMENT_UPDATED: '更新合同履约节点',
  CONTRACT_FULFILLMENT_PROOF_ATTACHED: '上传合同履约凭证',
  CATEGORY_UPDATED: '更新目录品类',
  CATEGORY_DELETED: '删除目录品类',
  // ── 预算 ──
  BUDGET_CONVERTED: '预算清单转采购项目',
  BID_SCHEDULE_CHANGE_NOTIFY: '通知开标时间变更',
  BID_OPENING_DECISION_NOTIFY: '通知开标决策',
  // ── 通用 ──
  CREATE: '新建',
  UPDATE: '更新',
  DELETE: '删除',
  RESTORE: '恢复',
  PUBLISH: '发布',
  HIDE: '隐藏',
  // ── 存量补录（2026-11-04 稳健复查：按 AuditLog 全量 action 对照，此前 18 个
  //    无标签的 action 会把英文动作码直接漏进操作历史标签位）──
  BID_AI_RERUN_ANALYSIS: '重跑 AI 投标分析',
  BID_BACKUP_VERIFY: '投标备份核验',
  BID_TENDER_DOC_RELOAD: '重新传标',
  CATALOG_APPLICATION_APPROVED: '目录申请 · 通过',
  CATALOG_APPLICATION_COUNTERED: '目录申请 · 还价',
  CATALOG_COUNTER_ACCEPTED: '目录还价 · 接受',
  EXPERT_DISABLE: '停用专家',
  EXPERT_ENABLE: '启用专家',
  EXPERT_RESUME: '恢复专家',
  EXPERT_RETIRE: '专家退库',
  SUPPLIER_DISABLED: '供应商停用',
  SUPPLIER_RESTORED: '供应商恢复',
  SUPPLIER_EVALUATION_CREATED: '新增供应商评价',
  SUPPLIER_LINK_APPROVED: '归属申请 · 通过',
  SUPPLIER_LINK_PASSED_STAFF: '归属申请 · 初审通过',
  SUPPLIER_LINK_PASSED_LEADER: '归属申请 · 复审通过',
  SUPPLIER_LINK_REJECTED: '归属申请 · 拒绝',
  查看账号密码: '查看账号密码',
  // ── 二轮补录（2026-11-09：对照后端 AuditLog 写入全集而非 DB 存量——当日库内只漏
  //    ADDENDUM_OPEN_TIME_SYNC 一个，但下列动作码一旦发生同样会把英文裸进标签位）──
  ADDENDUM_OPEN_TIME_SYNC: '补遗联动调整开标时间',
  BID_ACCEPT_DANGER: '确认接受解密失败',
  BID_AI_RETRY_BIDDERS: '重试 AI 投标方分析',
  BID_DECRYPT_OUTER: '解密投标外层信封',
  BID_DECRYPT_OUTER_V3: '解密投标外层信封',
  BID_DISPUTE_OVERRIDE: '开标异议强制裁决',
  BID_OPENING_FIELD_CONFIG_SET: '配置唱标字段',
  BID_OPENING_PAUSED: '暂停开标',
  BID_OPENING_RESUMED: '恢复开标',
  BID_PROJECT_REOPEN: '流标项目重新招标',
  BID_PROJECT_TIME_UPDATED: '调整开标/截标时间',
  CA_LOGIN: 'CA 证书登录',
  CUSTOM_EXTRACTION_PROJECT_CREATED: '手工创建抽取项目',
  EVALUATION_REOPEN: '重开评标',
  EXPERT_REPORT_UNCONFIRMED: '撤销评审报告确认',
  EXPERT_VIEW_DOCUMENT: '专家查阅投标文件',
  EXPERT_VIEW_DOCUMENTS_SUMMARY: '专家查阅投标文件清单',
  PLATFORM_PUSH: '平台推送',
  SUPERVISION_PUSH: '监督数据推送',
  SUPPLIER_LINK_DISABLED: '停用公司归属',
  SUPPLIER_LINK_ENABLED: '启用公司归属',
  SUPPLIER_RESUBMITTED: '重新提交补正资料',
  SUPPLIER_CHANGE_APPROVED: '供应商资料变更 · 通过',
  SUPPLIER_CHANGE_REJECTED: '供应商资料变更 · 拒绝',
  SUPPLIER_CONVERTED_REGULAR: '临时供应商转正式',
  SUPPLIER_ELIMINATED: '淘汰供应商',
  SUPPLIER_EVALUATION_UPDATED: '更新供应商评价',
  SUPPLIER_REACTIVATED: '复活被拒供应商申请',
  SUPPLIER_TAGS_UPDATED: '更新业务标签',
  SUPPLIER_TAGS_BACKFILL: '业务标签批量回填',
  SUPPLIER_UNBLACKLIST: '移出黑名单',
};

/** 会话/心跳类动作——操作历史不展示（淹没业务动作的噪音） */
const NOISE_ACTIONS = new Set(['LOGIN', 'LOGOUT']);

/** 供应商段的语义前缀（2026-11-04 用户误读实录）：资源行裸列「四川水发建设有限公司」
 *  被读成"建设公司的数据"——该名目实为投标供应商（澄清对象），标注角色消歧。 */
const SUPPLIER_SCOPE_LABEL: Record<string, string> = {
  BID_CLARIFICATION_CREATE: '澄清对象',
  BID_DECRYPT: '解密对象',
};

/** 操作历史资源描述行（2026-11-04 用户口径）：项目名（后端解析）· 资源名前缀（中文
 *  `供应商名:<主键>` 形态取冒号前）· 供应商名（details/后端解析）· 邀请家数。全部
 *  解析不到时不显示该行——`BidProject:<cuid>`/`supplier_company_link` 等黑话不再裸出。 */
function activityResourceLine(a: AuditActivity): string | null {
  const d = a.details ?? {};
  const parts: string[] = [];
  // details.projectName 是写时快照：项目已删/改名时它是唯一名源（抽取确认等写入即带）
  if (a.resourceName) parts.push(a.resourceName);
  else if (typeof d.projectName === 'string' && d.projectName) parts.push(d.projectName);
  // `名:cuid` 复合形态：头段含中文即人写对象名（解密的「四川省xx大队:<id>」等），冒号后是主键
  const rt = a.resourceType;
  if (rt?.includes(':')) {
    const head = rt.slice(0, rt.indexOf(':'));
    if (/[一-鿿]/.test(head) && head !== a.resourceName) parts.push(head);
  }
  const supplier = typeof d.supplierName === 'string' && d.supplierName ? d.supplierName : a.supplierName;
  if (supplier) {
    const scope = SUPPLIER_SCOPE_LABEL[a.action];
    parts.push(scope ? `${scope}：${supplier}` : supplier);
  }
  if (typeof d.target === 'string' && d.target) parts.push(d.target);
  if (typeof d.added === 'number') parts.push(`新邀 ${d.added} 家`);
  if (parts.length > 0) return [...new Set(parts)].join(' · ');
  if (!rt) return null;
  if (/^BidProject/.test(rt)) return '投标项目';
  return /[一-鿿]/.test(rt) ? rt : null; // 纯 ASCII 黑话形态不显示，优于裸主键
}

/** 连发折叠（2026-11-04）：同一动作+同一资源+同一供应商 2 分钟内连发多行（双击重放，
 *  实测对间隔 ~0.6s 的成对澄清记录）只显示一行并带 ×N 计数——审计底账不动，纯展示层
 *  聚合。供应商入键：同项目 2 分钟内向不同供应商各发澄清不会误并成一行。
 *  userId 入键（2026-11-06 全中心视图）：不同操作人的同型动作不得并成一行。 */
function groupActivities(acts: AuditActivity[]): AuditActivity[][] {
  const groups: AuditActivity[][] = [];
  for (const a of acts) {
    const last = groups[groups.length - 1];
    const head = last?.[0];
    const gap = head ? new Date(head.createdAt).getTime() - new Date(a.createdAt).getTime() : Infinity;
    const supplierOf = (x: AuditActivity) =>
      (typeof x.details?.supplierName === 'string' ? x.details.supplierName : x.supplierName) ?? '';
    if (
      head && gap <= 120_000 &&
      head.action === a.action && head.resourceType === a.resourceType && head.resourceId === a.resourceId &&
      head.userId === a.userId && supplierOf(head) === supplierOf(a)
    ) last.push(a);
    else groups.push([a]);
  }
  return groups;
}

function fmt(dt: string | null | undefined) {
  if (!dt) return '—';
  const d = new Date(dt);
  return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** 时间到秒（操作历史元信息行）——列表主时间保留分钟粒度，审计明细需秒级 */
function fmtSec(dt: string | null | undefined) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

/** UA → 短标签「浏览器/平台」（操作历史元信息行）；解析不出返回 null 不显示 */
function uaLabel(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const os = /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua) ? 'macOS'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Linux/.test(ua) ? 'Linux' : null;
  const br = /Edg\//.test(ua) ? 'Edge'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari' : null;
  return [br, os].filter(Boolean).join('/') || null;
}

/** details 明细行（2026-11-06 用户口径「每条更详细」）：白名单键→中文标签，最多 4 项。
 *  键集按 AuditLog 实测形态校准（EXPERT_EXTRACTION_CONFIRMED/DEMAND_REP_EXTERNAL_CREATE/
 *  查看账号密码/PROFILE_CHANGE_APPROVED 等）；已由资源行消费的键（projectName/
 *  supplierName/target/added）不重复；cuid 形态值、超长值不裸出（同通知文案治理口径）。
 *  「查看账号密码」按动作特译（2026-11-06 用户反馈「命中/身份不知所云」）：role=被查账号
 *  的角色、hit=是否查到存档密码副本（工作人员账号无副本）——generic 键表不再收录这两个键。 */
const DETAIL_LABEL: Record<string, string> = {
  reason: '原因', stage: '审批级', title: '标题', count: '数量',
  departmentName: '部门', officeLocation: '办公地', newName: '新名', oldName: '旧名',
  expertName: '专家', employer: '单位', expertCount: '专家数', extractMode: '抽取方式',
  fields: '变更字段',
};
const STAGE_CN: Record<string, string> = { STAFF: '初审', LEADER: '复审', ADMIN: '终审' };
const EXTRACT_MODE_CN: Record<string, string> = { random: '随机抽取', rule: '规则引擎', ai: '智能抽取', custom: '自定义' };
const ROLE_CN: Record<string, string> = { admin: '管理员', leader: '领导', staff: '员工', supplier: '供应商', bid_expert: '评标专家', bid_host: '开标主持人' };
/** 资料变更字段英文名 → 中文（PROFILE_CHANGE payload 白名单同集） */
const FIELD_CN: Record<string, string> = {
  displayName: '姓名', email: '邮箱', phone: '手机号', officeLocation: '办公地点',
  company: '公司', departmentId: '部门', avatar: '头像',
};
function detailLabelOf(action: string, key: string): string | null {
  if (action === '查看账号密码') {
    if (key === 'role') return '被查账号';
    if (key === 'hit') return '密码存档';
    return null;
  }
  return DETAIL_LABEL[key] ?? null;
}
function activityDetailLine(a: AuditActivity): string | null {
  const d = a.details ?? {};
  const parts: string[] = [];
  for (const [k, v] of Object.entries(d)) {
    const label = detailLabelOf(a.action, k);
    if (!label) continue;
    let sv: string;
    if (typeof v === 'boolean') sv = a.action === '查看账号密码' && k === 'hit' ? (v ? '查到' : '未查到') : v ? '是' : '否';
    else if (Array.isArray(v) && v.every(x => typeof x === 'string')) sv = v.map(x => FIELD_CN[x] ?? x).join('、');
    else if (typeof v === 'string' || typeof v === 'number') sv = String(v).trim();
    else continue;
    if (!sv || sv.length > 40 || /^c[a-z0-9]{20,}$/.test(sv)) continue;
    const cn = k === 'stage' ? STAGE_CN[sv] ?? sv
      : k === 'extractMode' ? EXTRACT_MODE_CN[sv] ?? sv
      : k === 'role' ? ROLE_CN[sv] ?? sv : sv;
    parts.push(`${label}：${cn}`);
    if (parts.length >= 4) break;
  }
  return parts.length ? parts.join(' · ') : null;
}

export default function NotificationsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<NotificationTab>('all'); // 默认打开「全部」
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [segmentCounts, setSegmentCounts] = useState<{ all: number; todo: number; done: number; toread: number; read: number }>({ all: 0, todo: 0, done: 0, toread: 0, read: 0 });

  // 窗口
  const [detail, setDetail] = useState<NotificationItem | null>(null);        // 查看（已办/待阅/已阅）
  const [handleItem, setHandleItem] = useState<NotificationItem | null>(null); // 处理（待办）
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activities, setActivities] = useState<AuditActivity[]>([]);
  const [detailActs, setDetailActs] = useState<AuditActivity[]>([]); // 已办窗内的结果记录
  // 操作历史视野（2026-11-06 用户裁定）：leader/admin=全中心留痕（带操作人），staff=仅本人
  const [myRole, setMyRole] = useState<string | null>(null);
  const [actTotal, setActTotal] = useState(0);
  const [histBusy, setHistBusy] = useState(false);   // 首载/加载更多
  const [exporting, setExporting] = useState(false); // txt 导出全量拉取中
  const HIST_PAGE = 100;

  useEffect(() => { fetchCurrentUser().then(u => setMyRole(u.role)).catch(() => {}); }, []);
  const isOrgScope = myRole === 'leader' || myRole === 'admin';

  /** 不上限（2026-11-06 用户裁定）：offset 逐页翻——加载更多与导出共用 */
  const fetchHistPage = (offset: number) =>
    (isOrgScope
      ? fetchAllActivities(HIST_PAGE, ['LOGIN', 'LOGOUT'], offset)
      : fetchMyActivities(HIST_PAGE, ['LOGIN', 'LOGOUT'], offset));

  const openHistory = () => {
    setHistoryOpen(true);
    setActivities([]); setActTotal(0); setHistBusy(true);
    fetchHistPage(0)
      .then(r => { setActivities(r.items); setActTotal(r.total); })
      .catch(() => { setActivities([]); setActTotal(0); })
      .finally(() => setHistBusy(false));
  };

  const loadMoreHistory = () => {
    setHistBusy(true);
    fetchHistPage(activities.length)
      .then(r => setActivities(prev => {
        const seen = new Set(prev.map(x => x.id));
        return [...prev, ...r.items.filter(x => !seen.has(x.id))];
      }))
      .catch(() => toast.error('加载失败，请重试'))
      .finally(() => setHistBusy(false));
  };

  /** 导出 txt：逐页拉全量（受当前视野口径），按天分段正序落档（UTF-8 BOM） */
  const exportHistory = async () => {
    setExporting(true);
    try {
      let all: AuditActivity[] = [];
      for (;;) {
        const r = await fetchHistPage(all.length);
        all = all.concat(r.items);
        if (r.items.length === 0 || all.length >= r.total) break;
      }
      const entries = all.filter(a => !NOISE_ACTIONS.has(a.action)).map(a => ({
        at: a.createdAt,
        operator: a.operator ? `${a.operator.name}${a.operator.role ? `（${ROLE_CN[a.operator.role] ?? a.operator.role}）` : ''}` : undefined,
        action: ACTION_LABEL[a.action] ?? a.action,
        subject: activityResourceLine(a) ?? undefined,
        detail: activityDetailLine(a) ?? undefined,
        meta: [a.ipAddress, uaLabel(a.userAgent)].filter(Boolean).join(' · ') || undefined,
      }));
      const n = downloadHistoryTxt(
        isOrgScope ? '通知中心·全中心' : '通知中心·本人',
        isOrgScope ? '全中心操作留痕（全部记录）' : '当前账号操作留痕（全部记录）',
        entries,
      );
      toast.success(`已导出 ${n} 条操作记录`);
    } catch {
      toast.error('导出失败，请重试');
    }
    setExporting(false);
  };

  const load = useCallback(() => {
    setLoading(true);
    listNotifications(tab, page, PAGE_SIZE)
      .then(r => { setItems(r.items); setTotal(r.total); if (r.segmentCounts) setSegmentCounts(r.segmentCounts); })
      .catch(() => { setItems([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [tab, page]);

  useEffect(() => { load(); }, [load]);

  // 打开已办查看窗时拉取相关操作记录（同类型、时间晚于通知）
  const openDetail = useCallback((n: NotificationItem) => {
    setDetail(n);
    setDetailActs([]);
    if (itemState(n) === 'done') {
      fetchMyActivities(50, ['LOGIN', 'LOGOUT']).then(r => {
        const key = n.type === 'USER_REGISTRATION_PENDING' ? 'USER_REGISTRATION_'
          : n.type === 'PROFILE_CHANGE_PENDING' ? 'PROFILE_CHANGE_'
          : n.type === 'SUPPLIER_PENDING' ? 'SUPPLIER_' : null;
        setDetailActs(key
          ? r.items.filter(a => a.action.startsWith(key) && new Date(a.createdAt) >= new Date(n.createdAt)).slice(0, 3)
          : []);
      }).catch(() => {});
    }
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const onRead = (id: string) => {
    void markNotificationRead(id).catch(() => {});
    setItems(xs => xs.map(x => (x.id === id ? { ...x, isRead: true, readAt: new Date().toISOString() } : x)));
  };

  /** 从通知 link 解析 supplierId（新 link=/supplier/approval?supplierId=…，2026-09-30） */
  const supplierIdFromLink = (link?: string | null): string | null => {
    if (!link) return null;
    const m = link.match(/supplierId=([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  };
  const openReviewCenter = (n: NotificationItem) => {
    const sid = supplierIdFromLink(n.link);
    window.dispatchEvent(new CustomEvent('open-review-center', { detail: { supplierId: sid ?? undefined } }));
  };

  const handleRowClick = (n: NotificationItem) => {
    if (itemState(n) === 'todo') {
      // 供应商审批（三级）已收敛到窗口式审批中心（2026-09-30）：直达审批中心窗口，
      // 不再内嵌简化审批（与审批中心双入口曾导致无级过滤、缺缘由/stepper 的不一致）。
      if (n.type === 'SUPPLIER_PENDING') {
        void markNotificationRead(n.id).catch(() => {});
        openReviewCenter(n);
        return;
      }
      setHandleItem(n);
    } else openDetail(n);
  };

  /* ════════════ 渲染 ════════════ */
  return (
    <div className="flex flex-col gap-4">
      {/* ── 标题栏：右上角 全部标已读 / 操作历史 / 刷新 ── */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><Bell size={17} /></div>
            <div>
              <div className="page-hero__title">通知中心</div>
              <div className="page-hero__sub">集中查看待办与已办事项、待阅与已阅消息</div>
            </div>
          </div>
          <div className="page-hero__right">
            <button className="neu-btn-soft" onClick={() => { void markAllNotificationsRead().then(() => load()); }}>
              <CheckCheck size={14} /> 全部标已阅
            </button>
            <button className="neu-btn-soft" onClick={openHistory}>
              <History size={14} /> 操作历史
            </button>
          </div>
        </div>
        {/* hairline 下横线（cgzxui 规定：标题行与下方内容之间必有分割线，与其他页面高度一致） */}
        <div className="page-hero__divider" />
      </div>

      {/* ── 工具行：五段状态切换（左）+ 计数/图例（右）——仿公告页面工具行设计，不置于标题栏内 ── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* 五段分段器 */}
        <div className="neu-segment" role="group" aria-label="通知状态" data-count="5"
          data-index={String(Math.max(0, SEGMENT.findIndex(t => t.key === tab)))}
          style={{ '--segs': 5 } as React.CSSProperties}>
          <span className="neu-segment-thumb" aria-hidden="true" />
          {SEGMENT.map(t => (
            <button key={t.key} type="button" className="neu-segment-btn" aria-pressed={tab === t.key}
              onClick={() => { setTab(t.key); setPage(1); }}>
              <t.icon size={13} strokeWidth={1.9} aria-hidden="true" /> {t.label}
              {t.key !== 'all' && segmentCounts[t.key] > 0 && <span className={`neu-segment-count${t.key === 'todo' || t.key === 'toread' ? ' neu-segment-count--danger' : ''}`}>{segmentCounts[t.key] > 99 ? '99+' : segmentCounts[t.key]}</span>}
            </button>
          ))}
        </div>
        <span className="text-[11px] font-semibold tabular-nums text-[var(--muted-foreground)]">共 {total} 条 · 第 {page}/{totalPages} 页</span>
        <div className="ml-auto flex items-center gap-3 text-[10px] font-semibold text-[var(--muted-foreground)]">
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-[4px] bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] ring-1 ring-[color-mix(in_oklch,var(--danger)_28%,transparent)]" />待处理 / 待查阅</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-[4px] bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)] ring-1 ring-[color-mix(in_oklch,var(--muted-foreground)_22%,transparent)]" />已处理 / 已查阅</span>
        </div>
      </div>

      {/* ── 平铺列表（不聚合，时间倒序） ── */}
      <div className="neu-table-card">
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[820px]">
            <thead>
              <tr>
                <th>时间</th>
                {/* 类型列定宽（2026-10-13）：六字标签（账号安全反馈/评标安全预警）不再被挤压换行 */}
                <th style={{ width: 118 }}>类型</th>
                <th style={{ textAlign: 'left' }}>消息内容</th>
                <th style={{ width: 56, textAlign: 'center' }}>状态</th>
                <th style={{ textAlign: 'center' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="py-16 text-center"><Loader2 size={16} className="mx-auto animate-spin text-[var(--muted-foreground)]" /></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={5} className="py-16 text-center text-sm text-[var(--muted-foreground)]">此分类下暂无通知</td></tr>
              ) : items.map(n => {
                const st = itemState(n);
                const isHot = st === 'todo' || st === 'toread';
                return (
                  <tr key={n.id}
                    className={`row-clickable cursor-pointer ${isHot
                      ? 'bg-[color-mix(in_oklch,var(--danger)_4%,transparent)] hover:bg-[color-mix(in_oklch,var(--danger)_7%,transparent)]'
                      : 'bg-[color-mix(in_oklch,var(--muted-foreground)_4%,transparent)] opacity-70 hover:opacity-100'}`}
                    onClick={() => handleRowClick(n)}>
                    <td className="whitespace-nowrap text-[0.78rem] tabular-nums text-[var(--muted-foreground)]">{fmt(n.createdAt)}</td>
                    <td><NotifTypeBadge type={n.type} /></td>
                    <td style={{ textAlign: 'left' }}>
                      <span className="line-clamp-1 text-[0.82rem] leading-relaxed text-[var(--foreground)]" title={n.content}>{n.content}</span>
                    </td>
                    <td style={{ textAlign: 'center' }}><StateChip state={st} /></td>
                    <td onClick={e => e.stopPropagation()} style={{ textAlign: 'center' }}>
                      {st === 'todo' ? (
                        <button className="neu-btn-xs" onClick={() => {
                          if (n.type === 'SUPPLIER_PENDING') {
                            void markNotificationRead(n.id).catch(() => {});
                            openReviewCenter(n);
                          } else setHandleItem(n);
                        }}>处理</button>
                      ) : (
                        <button className="neu-btn-xs" onClick={() => openDetail(n)}>查看</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="neu-table-card-footer flex items-center justify-end gap-3">
            <span className="text-[11px] font-medium tabular-nums text-[var(--muted-foreground)]">共 {total} 条 · 第 {page}/{totalPages} 页</span>
            <div className="flex gap-1.5">
              <button className="neu-btn-xs !px-2" disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label="上一页">
                <ChevronLeft size={15} strokeWidth={2} />
              </button>
              <button className="neu-btn-xs !px-2" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} aria-label="下一页">
                <ChevronRight size={15} strokeWidth={2} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ═══ 查看窗（已办/待阅/已阅） ═══ */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.title ?? '通知详情'}
        description={detail ? `${getNotificationLabel(detail.type)} · ${fmt(detail.createdAt)}` : undefined}
        footer={
          <>
            {detail && itemState(detail) === 'toread' && (
              <button className="neu-btn-soft !h-[38px]" onClick={() => { onRead(detail.id); setDetail(d => (d ? { ...d, isRead: true, readAt: new Date().toISOString() } : d)); }}>
                <CheckCheck size={14} /> 标为已阅
              </button>
            )}
            {(() => { if (!detail) return null; const target = resolveNotificationLink(detail.link); return target && itemState(detail) !== 'done' && (
              <button className="neu-btn-soft" onClick={() => { setDetail(null); openNotificationLink(target, router); }}>
                跳转页面
              </button>
            ); })()}
            <button className="neu-btn-soft" onClick={() => setDetail(null)}>关闭</button>
          </>
        }
      >
        {detail && <ViewBody n={detail} acts={detailActs} />}
      </Modal>

      {/* ═══ 处理窗（待办：窗内直接审批） ═══ */}
      {handleItem && (
        <HandleModal item={handleItem} onClose={() => setHandleItem(null)} onDone={() => { setHandleItem(null); load(); }} />
      )}

      {/* ═══ 操作历史（标题栏右上角）—— xl 加宽 + 每条明细（2026-11-06 用户口径；
          leader/admin 视野=全中心留痕并标操作人，staff=仅本人）；不限量逐页加载 + txt 导出 ═══ */}
      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="操作历史" size="xl"
        description={isOrgScope ? '全中心操作留痕 · 按时间倒序 · 可加载全部' : '当前账号的操作留痕 · 按时间倒序 · 可加载全部'}
        headerExtra={
          <button className="neu-btn-xs" onClick={() => void exportHistory()} disabled={exporting || activities.length === 0}>
            {exporting ? <><Loader2 size={12} className="animate-spin" /> 导出中…</> : <><Download size={12} /> 导出 txt</>}
          </button>
        }
        footer={<button className="neu-btn-soft" onClick={() => setHistoryOpen(false)}>关闭</button>}>
        <div className="max-h-[60vh] overflow-y-auto pr-1">
          {(() => {
            const groups = groupActivities(activities.filter(a => !NOISE_ACTIONS.has(a.action)));
            if (groups.length === 0) {
              return <p className="py-10 text-center text-sm text-[var(--muted-foreground)]">{histBusy ? '加载中…' : '暂无操作记录'}</p>;
            }
            return (
            <div className="space-y-2">
              {groups.map(group => {
                const a = group[0];
                const label = ACTION_LABEL[a.action];
                const isApprove = label?.includes('通过');
                const isReject = label?.includes('拒绝') || label?.includes('退回');
                const resource = activityResourceLine(a);
                return (
                  <div key={a.id} className="flex items-start gap-3 rounded-xl bg-[color-mix(in_oklch,var(--muted-foreground)_5%,transparent)] px-4 py-3">
                    <Clock size={13} className="mt-1 shrink-0 text-[var(--muted-foreground)]" />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        {a.operator && (
                          <span className="text-[11px] font-semibold text-[var(--foreground)]">
                            {a.operator.name}{a.operator.role ? `（${ROLE_CN[a.operator.role] ?? a.operator.role}）` : ''}
                          </span>
                        )}
                        <span className={`inline-flex items-center gap-1 rounded-[6px] px-2 py-0.5 text-[11px] font-bold ${
                          isApprove ? 'bg-[color-mix(in_oklch,var(--success)_12%,transparent)] text-[var(--success)]'
                          : isReject ? 'bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] text-[var(--danger)]'
                          : 'bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)] text-[var(--muted-foreground)]'}`}>
                          {label ?? a.action}
                        </span>
                        {group.length > 1 && (
                          <span
                            className="inline-flex items-center rounded-[6px] bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--accent)]"
                            title={`2 分钟内连发 ${group.length} 次（重复提交），已折叠显示`}>
                            ×{group.length}
                          </span>
                        )}
                      </p>
                      {/* 资源行与动作徽章同文（如「资料变更审批」）时不重复显示 */}
                      {resource && !(label ?? a.action).startsWith(resource) && (
                        <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted-foreground)]">{resource}</p>
                      )}
                      {(() => {
                        const detail = activityDetailLine(a);
                        return detail ? <p className="mt-1 text-[11px] leading-relaxed text-[var(--foreground)]/75">{detail}</p> : null;
                      })()}
                      <p className="mt-1 font-mono text-[10px] tabular-nums leading-relaxed text-[var(--muted-foreground)]/60">
                        {fmtSec(a.createdAt)}
                        {a.ipAddress ? ` · ${a.ipAddress}` : ''}
                        {uaLabel(a.userAgent) ? ` · ${uaLabel(a.userAgent)}` : ''}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            );
          })()}
          {/* 不上限（2026-11-06 用户裁定）：逐页翻页直至全部记录 */}
          {activities.length < actTotal && (
            <div className="mt-3 flex items-center justify-center gap-2 pb-1">
              <button className="neu-btn-soft !px-3 !py-1.5 !text-[11px]" onClick={loadMoreHistory} disabled={histBusy}>
                {histBusy ? <Loader2 size={12} className="animate-spin" /> : null}
                加载更多（已显示 {activities.length} / 共 {actTotal} 条）
              </button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

/* ════════════ 查看窗内容（已办带处理时间+结果；已阅带查阅时间） ════════════ */
function ViewBody({ n, acts }: { n: NotificationItem; acts: AuditActivity[] }) {
  const st = itemState(n);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <NotifTypeBadge type={n.type} />
        <StateChip state={st} />
      </div>
      <p className="whitespace-pre-wrap break-words rounded-xl bg-[color-mix(in_oklch,var(--muted-foreground)_6%,transparent)] px-4 py-3 text-[0.85rem] leading-relaxed text-[var(--foreground)]">
        {n.content}
      </p>
      {st === 'done' && (
        <div className="space-y-1.5 rounded-xl border border-dashed border-[color-mix(in_oklch,var(--muted-foreground)_25%,transparent)] px-4 py-3">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--foreground)]">
            <CircleCheck size={13} className="text-[var(--success)]" />
            处理时间：{n.resolvedAt ? fmt(n.resolvedAt) : n.readAt ? `${fmt(n.readAt)}（标记已阅）` : '—'}
          </p>
          {acts.length > 0 ? (
            acts.map(a => {
              const resource = activityResourceLine(a);
              return (
                <p key={a.id} className="pl-[19px] text-[11.5px] leading-relaxed text-[var(--muted-foreground)]">
                  处理结果：{ACTION_LABEL[a.action] ?? a.action}{resource ? `（${resource}）` : ''} · {fmt(a.createdAt)}
                </p>
              );
            })
          ) : (
            <p className="pl-[19px] text-[11.5px] text-[var(--muted-foreground)]">处理结果：未找到留痕记录（早期操作或无需审批动作）</p>
          )}
        </div>
      )}
      {st === 'read' && (
        <p className="flex items-center gap-1.5 rounded-xl border border-dashed border-[color-mix(in_oklch,var(--muted-foreground)_25%,transparent)] px-4 py-3 text-[12px] font-semibold text-[var(--foreground)]">
          <BookOpen size={13} className="text-[var(--muted-foreground)]" />
          查阅时间：{n.readAt ? fmt(n.readAt) : '—'}
        </p>
      )}
    </div>
  );
}

/* ════════════ 处理窗：窗内直接处理（审批类通过/拒绝+原因必填；反馈类底部跳转） ════════════ */
type PendingRow = { id: string; title: string; sub: string; stage?: string }; // stage=供应商三级审批当前级（R6-2）

function HandleModal({ item, onClose, onDone }: { item: NotificationItem; onClose: () => void; onDone: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [rows, setRows] = useState<PendingRow[] | null>(null); // null=加载中，[]=无可审批项
  const [selected, setSelected] = useState(0);

  const supplierId = useMemo(() => {
    const m = /\/supplier\/([^/?]+)/.exec(item.link ?? '');
    const seg = m?.[1] ?? null;
    // R6-2（2026-09-30 审计 B-2）：三级审批新政后注册通知 link=/supplier/approval（无 id），
    // 'approval' 被当供应商 id 直查必败、伪装"已被其他审批人处理"。识别非 id 段 → 列表模式。
    if (!seg || seg === 'approval' || seg === 'repository') return null;
    return seg;
  }, [item.link]);
  // 三级审批级名（与审批中心同口径）
  const STAGE_LABEL: Record<string, string> = { STAFF: '初审', LEADER: '复审', ADMIN: '终审' };
  // 通知 link 携带的业务 id——用于在待处理列表中直达本条：
  // 资料变更带 requestId（password-requests.service）；注册待审带 userId
  // （auth.service，PendingRegistration.id 即 userId）——只解析 requestId 会漏注册分支（三审 P1）
  const linkRequestId = useMemo(() => {
    const q = item.link?.split('?')[1];
    if (!q) return null;
    const params = new URLSearchParams(q);
    return params.get('requestId') ?? params.get('userId') ?? params.get('supplierId'); // R6 终审 P2-2：供应商注册通知 link 带 supplierId
  }, [item.link]);

  const isApproval = ['PROFILE_CHANGE_PENDING', 'USER_REGISTRATION_PENDING', 'SUPPLIER_PENDING'].includes(item.type);
  const isSupplier = item.type === 'SUPPLIER_PENDING';

  // 拉取当前待处理项；link 带 requestId 时预选对应申请（2026-09-29：此前拉全量待审、
  // 默认选第 1 条——点通知 A 实际审批的可能是通知 B 对应的申请）
  useEffect(() => {
    if (!isApproval) return;
    const setter = (list: PendingRow[]) => {
      setRows(list);
      const hit = linkRequestId ? list.findIndex((r) => r.id === linkRequestId) : -1;
      setSelected(hit >= 0 ? hit : 0);
    };
    if (item.type === 'PROFILE_CHANGE_PENDING') {
      fetchPendingProfileChanges().then(rs => setter((rs as any[]).map(r => ({
        id: r.id,
        title: r.user?.displayName ?? r.user?.username ?? '',
        sub: `变更字段：${Object.keys(r.payload ?? {}).join('、')} · ${fmt(r.requestedAt)}`,
      })))).catch(() => setter([]));
    } else if (item.type === 'USER_REGISTRATION_PENDING') {
      fetchPendingRegistrations().then(rs => setter((rs as any[]).map(r => ({
        id: r.id,
        title: `${r.displayName ?? r.username}${r.company ? `（${r.company}）` : ''}`,
        sub: '申请管理端账号',
      })))).catch(() => setter([]));
    } else if (item.type === 'SUPPLIER_PENDING') {
      // 无直达 id（新政 link=/supplier/approval 或旧 link=/supplier）→ 在审供应商列表
      getSupplierList({ status: 'PENDING', page: 1, pageSize: 20 }).then(rs => setter((rs.items as any[]).map(r => ({
        id: r.id,
        title: r.name,
        sub: `${r.creditCode ?? '—'} · 当前级：${STAGE_LABEL[(r as any).reviewStage] ?? '初审'}`,
        stage: (r as any).reviewStage ?? 'STAFF',
      })))).catch(() => setter([]));
    } else if (supplierId) {
      getSupplier(supplierId).then(s => setter([{
        id: supplierId,
        title: s.name,
        sub: `信用代码 ${s.creditCode ?? '—'} · ${s.legalPerson ?? '—'} · 注册于 ${new Date(s.createdAt).toLocaleDateString('zh-CN')}`,
        stage: (s as any).reviewStage ?? 'STAFF',
      }])).catch(() => setter([]));
    } else setter([]);
  }, [item.type, supplierId, linkRequestId]);

  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    setBusy(true);
    try { await fn(); if (okMsg) toast.success(okMsg); onDone(); } // 空消息=fn 内已按结果区分 toast
    catch (e: any) { toast.error(e?.message ?? '操作失败'); }
    setBusy(false);
  };

  const cur = rows && rows.length > 0 ? rows[Math.min(selected, rows.length - 1)] : null;

  const doApprove = () => {
    if (!cur) return;
    if (item.type === 'PROFILE_CHANGE_PENDING') return void act(() => approveProfileChange(cur.id), '已通过');
    if (item.type === 'USER_REGISTRATION_PENDING') return void act(() => approveRegistration(cur.id), '已通过');
    // R6-2：三级审批——staff/leader 级通过须填同意缘由（后端 REVIEW_REASON_REQUIRED），
    // admin 终审可选；文案按后端返回 stage 区分"入库"与"流转下一级"
    const stage = (cur as any).stage as string | undefined;
    if (isSupplier && stage !== 'ADMIN' && !reason.trim()) { toast.error('请填写同意缘由（后级审批人将据此复核）'); return; }
    return void act(
      () => approveSupplier(cur.id, reason.trim() || undefined).then(res => {
        // R7 终检：消息统一在此按流转结果区分（此前非终审会弹两条矛盾 toast——
        // fn 内"流转至下一级"+act 固定"三级全部通过"）
        toast.success(res?.stage === 'DONE'
          ? '三级审核全部通过，已正式入库'
          : `已通过${STAGE_LABEL[stage ?? 'STAFF'] ?? '本级'}，流转至${STAGE_LABEL[res?.stage ?? ''] ?? '下一级'}`);
        return res;
      }),
      '',
    );
  };
  const doReject = () => {
    if (!cur) return;
    if (!reason.trim()) { toast.error('请填写原因'); return; }
    if (item.type === 'PROFILE_CHANGE_PENDING') return void act(() => rejectProfileChange(cur.id, reason.trim()), '已拒绝');
    if (item.type === 'USER_REGISTRATION_PENDING') return void act(() => rejectRegistration(cur.id, reason.trim()), '已拒绝');
    return void act(() => rejectSupplier(cur.id, reason.trim()), '已拒绝');
  };
  const doReturn = () => {
    if (!cur) return;
    if (!reason.trim()) { toast.error('请填写原因'); return; }
    void act(() => returnSupplier(cur.id, reason.trim()), '已退回补正');
  };

  return (
    <Modal open onClose={onClose}
      size="lg"
      title={`处理 · ${getNotificationLabel(item.type)}`}
      description={fmt(item.createdAt)}
      footer={
        <>
          {isApproval ? (
            <>
              <button className="neu-btn-soft" onClick={onClose}>关闭</button>
              {isSupplier && <button className="neu-btn-soft" disabled={busy || !cur} onClick={doReturn}><RotateCcw size={14} /> 退回补正</button>}
              <button className="neu-btn-soft is-danger" disabled={busy || !cur} onClick={doReject}><XCircle size={14} /> 拒绝</button>
              <button className="neu-btn-soft is-success !h-[38px]" disabled={busy || !cur} onClick={doApprove}><CheckCircle2 size={14} /> 通过</button>
              {resolveNotificationLink(item.link) && <button className="neu-btn-soft !h-[38px]" onClick={() => { onClose(); openNotificationLink(item.link, router); }}>前往审批中心</button>}
            </>
          ) : (
            <>
              <button className="neu-btn-soft" onClick={onClose}>关闭</button>
              {resolveNotificationLink(item.link) && (
                <button className="neu-btn-soft !h-[38px]" onClick={() => { onClose(); openNotificationLink(item.link, router); }}>跳转页面</button>
              )}
              {/* 复核型待办（2026-11-03 用户实录）：无审批动作，复核完成即点此归档——
                  此前无任何消解路径（预警类待办点了也永不消失）。
                  2026-11-04 修正：改调 resolve（resolvedAt 落库）——此前误调 markAsRead，
                  后端对 actionable 未办结通知按"点开≠办结"守卫 no-op，toast 谎报成功、
                  刷新后仍滞留待办段 */}
              <button className="neu-btn-soft is-success !h-[38px]" disabled={busy}
                onClick={() => act(() => resolveNotification(item.id), '已标记为已办')}>
                <CheckCircle2 size={14} /> 标记已办
              </button>
            </>
          )}
        </>
      }>
      <div className="flex flex-col gap-3">
        {isApproval ? (
          rows === null ? (
            <p className="py-6 text-center text-sm text-[var(--muted-foreground)]"><Loader2 size={14} className="mx-auto animate-spin" /></p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--muted-foreground)]">当前没有待处理项（可能已被其他审批人处理）</p>
          ) : (
            <>
              <div className="space-y-2">
                {rows.map((r, i) => (
                  <button key={r.id} type="button" onClick={() => setSelected(i)}
                    className={`w-full rounded-xl px-4 py-3 text-left transition-all ${i === selected
                      ? 'bg-[oklch(1_0_0)] shadow-[inset_0_1px_0_oklch(1_0_0/0.95),2px_2px_6px_oklch(0.55_0.03_258/0.16),-1px_-1px_2px_oklch(1_0_0/0.9)] ring-1 ring-[color-mix(in_oklch,var(--accent)_35%,transparent)]'
                      : 'bg-[color-mix(in_oklch,var(--muted-foreground)_5%,transparent)] hover:bg-[color-mix(in_oklch,var(--muted-foreground)_8%,transparent)]'}`}>
                    <span className={`block text-[13px] font-bold ${i === selected ? 'text-[var(--accent)]' : 'text-[var(--foreground)]'}`}>{r.title}</span>
                    <span className="mt-0.5 block text-[11px] text-[var(--muted-foreground)]">{r.sub}</span>
                  </button>
                ))}
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-bold text-[var(--muted-foreground)]">审批原因（拒绝{isSupplier ? ' / 退回 / 非终审通过' : ''}时必填）</label>
                <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} placeholder="填写原因…" className="neu-input w-full !text-xs" />
              </div>
            </>
          )
        ) : (
          <p className="whitespace-pre-wrap break-words rounded-xl bg-[color-mix(in_oklch,var(--muted-foreground)_6%,transparent)] px-4 py-3 text-[0.85rem] leading-relaxed text-[var(--foreground)]">
            {item.content}
          </p>
        )}
      </div>
    </Modal>
  );
}

/* ════════════ 小组件 ════════════ */
const TONE_VAR: Record<string, string> = {
  green: 'var(--success)', blue: 'var(--accent)', orange: 'var(--warning)',
  red: 'var(--danger)', purple: 'var(--accent-strong)', gray: 'var(--muted-foreground)',
};

function NotifTypeBadge({ type }: { type: string }) {
  const meta = getNotificationMeta(type);
  const colorVar = TONE_VAR[meta.tone] ?? TONE_VAR.gray;
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-[6px] px-2 py-0.5 text-[11px] font-semibold"
      style={{ color: colorVar, background: `color-mix(in oklch, ${colorVar} 9%, transparent)` }}>
      {getNotificationLabel(type)}
    </span>
  );
}

function StateChip({ state }: { state: 'todo' | 'done' | 'toread' | 'read' }) {
  const M: Record<string, { t: string; cls: string }> = {
    todo: { t: '待办', cls: 'text-[var(--danger)] bg-[color-mix(in_oklch,var(--danger)_9%,transparent)]' },
    toread: { t: '待阅', cls: 'text-[var(--danger)] bg-[color-mix(in_oklch,var(--danger)_9%,transparent)]' },
    done: { t: '已办', cls: 'text-[var(--muted-foreground)] bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)]' },
    read: { t: '已阅', cls: 'text-[var(--muted-foreground)] bg-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)]' },
  };
  const m = M[state];
  return <span className={`inline-flex items-center justify-center whitespace-nowrap rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold ${m.cls}`}>{m.t}</span>;
}
