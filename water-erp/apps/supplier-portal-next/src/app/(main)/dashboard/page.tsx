"use client";

/**
 * 业务工作台 — 迁移自 Vue supplier-portal Dashboard.vue
 * 数据源：getDashboardStats / getStatus（上下文）/ bidApi.listProjects(1,20) /
 *        通知上下文（30s 轮询刷新列表）；临时供应商分支含转正弹窗（预填 + 校验 + 上传）。
 */
import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import { toast } from "sonner";
import {
  ArrowRight,
  Bell,
  Building2,
  CheckCircle2,
  Clock,
  Folder,
  Landmark,
  Medal,
  Phone,
  TriangleAlert,
  Trophy,
} from "lucide-react";
import { ApiError } from "@/lib/api";
import { supplierApi } from "@/lib/api/supplier";
import { bidApi } from "@/lib/api/bid";
import { awardLetterApi, type AwardLetterDelivery } from "@/lib/api/award-letter";
import { contractApi, type SpContract } from "@/lib/api/contract";
import { uploadFile } from "@/lib/api/upload";
import { useNotifications } from "@/lib/notification-context";
import { useSupplierStatus } from "@/lib/supplier-status-context";
import {
  SpButton,
  SpDateInput,
  SpDialog,
  SpInput,
  SpSelect,
  SpSwitch,
  SpTextarea,
} from "@/components/ui";
import { ENTERPRISE_TYPES, QUAL_TYPE_OPTIONS } from "@/constants/supplier";
import { ServerClock } from "@/components/server-clock";
import { buildSupplierTasks } from "@/lib/supplier-tasks";
import { serverNowMs, syncServerClock } from "@water-erp/shared";

import "@/styles/pages/dashboard.css";
import "@/styles/pages/notifications.css"; // 通知详情弹窗 nd-*（原 dashboard.css 子集，去重归一后共用）

/* ─── 常量（与 Vue 版一致） ─── */
const STATUS_LABEL: Record<string, string> = {
  PENDING: "待审核", RETURNED: "退回补正", APPROVED: "已入库",
  REJECTED: "审核不通过", DISABLED: "已停用", BLACKLIST: "黑名单",
};
const STATUS_TYPE: Record<string, string> = {
  PENDING: "pending", RETURNED: "returned", APPROVED: "approved",
  REJECTED: "rejected", DISABLED: "disabled", BLACKLIST: "disabled",
};

const NOTIF_COLORS: Record<string, { dot: string; glow: string }> = {
  SUPPLIER_APPROVED: { dot: "#059669", glow: "rgba(5,150,105,0.18)" },
  SUPPLIER_REJECTED: { dot: "#dc2626", glow: "rgba(220,38,38,0.18)" },
  SUPPLIER_RETURNED: { dot: "#d97706", glow: "rgba(217,119,6,0.18)" },
  BID_PUBLISHED: { dot: "#2563eb", glow: "rgba(37,99,235,0.18)" },
  BID_INVITED: { dot: "#db2777", glow: "rgba(219,39,119,0.18)" },
  BID_REMINDER: { dot: "#ea580c", glow: "rgba(234,88,12,0.18)" },
  BID_OPENING: { dot: "#0891b2", glow: "rgba(8,145,178,0.18)" },
  BID_EVALUATION_RESULT: { dot: "#7c3aed", glow: "rgba(124,58,237,0.18)" },
  CLARIFICATION_REPLIED: { dot: "#0d9488", glow: "rgba(13,148,136,0.18)" },
  SYSTEM: { dot: "#475569", glow: "rgba(71,85,105,0.18)" },
};

const STAGES = [
  { key: "DOWNLOAD", label: "文件下载", color: "#0891b2" },
  { key: "SUBMIT", label: "加密投递", color: "#c00a6b" },
  { key: "OPENING", label: "在线开标", color: "#d97706" },
  { key: "EVALUATING", label: "专家评标", color: "#7c3aed" },
  { key: "ARCHIVED", label: "已归档", color: "#059669" },
] as const;

interface CatDim {
  key: string; label: string; score: number; max: number; filled: number; total: number;
  icon: ComponentType<{ size?: number | string; className?: string; strokeWidth?: number }>;
  color: string; missing: string[]; count?: number; hasPrimary?: boolean; hasLicense?: boolean;
}

interface ConvertContact { name: string; phone: string; email: string; position: string; isPrimary: boolean }
interface ConvertQual { type: string; name: string; fileUrl: string; validFrom: string; validTo: string }

/** 骨架卡 — Vue SkeletonCard.vue（avatar 未用于本页，略） */
function SkeletonCard({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`skeleton-card${className ? ` ${className}` : ""}`}>
      <div className="skeleton-lines">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="skeleton-line" style={{ width: i === lines - 1 ? "60%" : "100%" }} />
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { notifications, fetchNotifications, markAsRead } = useNotifications();
  const { status: statusInfo, fetchStatus } = useSupplierStatus();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [awards, setAwards] = useState<AwardLetterDelivery[]>([]);
  const [contracts, setContracts] = useState<SpContract[]>([]);
  const [nowMs, setNowMs] = useState(() => serverNowMs());

  /* ─── 数据加载（Vue onMounted Promise.all + retryLoad） ─── */
  const load = useCallback(async () => {
    setError(false);
    setLoading(true);
    try {
      const [statsRes, , projectsRes, awardsRes, contractsRes] = await Promise.all([
        supplierApi.getDashboardStats(),
        fetchStatus(),
        bidApi.listProjects({ page: 1, pageSize: 20 }),
        awardLetterApi.list().catch(() => []),
        contractApi.listMine().catch(() => []),
        fetchNotifications(1, 10),
      ]);
      setStats(statsRes);
      const res: any = projectsRes;
      setProjects(Array.isArray(res) ? res : res?.items || []);
      setAwards(awardsRes);
      setContracts(contractsRes);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [fetchStatus, fetchNotifications]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void syncServerClock().then(() => setNowMs(serverNowMs()));
    const timer = window.setInterval(() => setNowMs(serverNowMs()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // 每 30s 轮询新通知，有新消息自动刷新列表
  useEffect(() => {
    const notifTimer = setInterval(() => {
      fetchNotifications(1, 10).catch(() => {});
    }, 30_000);
    return () => clearInterval(notifTimer);
  }, [fetchNotifications]);

  /* ─── Profile completeness categories ─── */
  const completenessCats = useMemo<CatDim[]>(() => {
    const cats = stats?.profileCompleteness?.categories;
    if (!cats) return [];
    return [
      { key: "basic", label: "基本资料", ...cats.basic, icon: Building2, color: "#064ea2" },
      { key: "contacts", label: "联系人", ...cats.contacts, icon: Phone, color: "#0a5eb8" },
      { key: "qualifications", label: "资质材料", ...cats.qualifications, icon: Medal, color: "#059669" },
      ...(cats.bankAccounts ? [{ key: "bankAccounts", label: "银行账户", ...cats.bankAccounts, icon: Landmark, color: "#b45309" }] : []),
      ...(cats.performances ? [{ key: "performances", label: "主体业绩", ...cats.performances, icon: Trophy, color: "#7c3aed" }] : []),
    ];
  }, [stats]);

  function catStatLabel(cat: CatDim): string {
    if (cat.key === "basic") return `${cat.filled}/${cat.total} 项`;
    if (cat.key === "contacts") return `${cat.count ?? cat.filled} 人`;
    if (cat.key === "qualifications") return `${cat.count ?? cat.filled} 项`;
    if (cat.key === "bankAccounts") return `${cat.count ?? cat.filled} 个`;
    if (cat.key === "performances") return `${cat.count ?? cat.filled} 项`;
    return `${cat.filled}/${cat.total}`;
  }
  const profileScore = stats?.profileCompleteness?.score ?? 0;

  /* ─── Projects：前 8 条按紧急度排序（critical < warning < normal < past） ─── */
  const projectRows = useMemo(() => {
    const rank: Record<string, number> = { critical: 0, warning: 1, normal: 2, past: 3 };
    return projects.slice(0, 8).map((p: any) => {
      const dl = new Date(p.deadline).getTime();
      const daysLeft = Math.ceil((dl - nowMs) / 86400000);
      let urgency: "critical" | "warning" | "normal" | "past" = "normal";
      if (dl < nowMs) urgency = "past";
      else if (daysLeft <= 3) urgency = "critical";
      else if (daysLeft <= 14) urgency = "warning";
      return { project: p, daysLeft, urgency };
    }).sort((a, b) => rank[a.urgency] - rank[b.urgency]);
  }, [nowMs, projects]);

  const currentTasks = useMemo(() => buildSupplierTasks({
    nowMs,
    stats,
    projects,
    notifications,
    awards,
    contracts,
  }).slice(0, 8), [awards, contracts, notifications, nowMs, projects, stats]);

  /* ─── Notifications：未读置顶，同组按时间倒序，取 4 条 ─── */
  const notifFeed = useMemo(() =>
    [...notifications]
      .sort((a: any, b: any) => {
        const ru = a.isRead ? 1 : 0, rb = b.isRead ? 1 : 0;
        if (ru !== rb) return ru - rb;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })
      .slice(0, 4)
      .map((n: any) => ({ ...n, color: NOTIF_COLORS[n.type] || NOTIF_COLORS.SYSTEM })),
    [notifications]);

  /* ─── 通知详情弹窗 ─── */
  const [notifDetail, setNotifDetail] = useState<any>(null);
  function openNotifDetail(n: any) {
    setNotifDetail({ ...n });
  }
  /* ─── Days since registration / 临时供应商倒计时 ─── */
  const daysSinceReg = useMemo(() => {
    const created = statusInfo?.createdAt;
    if (!created) return null;
    return Math.ceil((nowMs - new Date(created).getTime()) / 86400000);
  }, [nowMs, statusInfo]);
  const daysRemaining = useMemo(() => {
    const exp = statusInfo?.temporaryExpiresAt;
    if (!exp) return "--";
    const days = Math.ceil((new Date(exp).getTime() - nowMs) / 86400000);
    return Math.max(0, days);
  }, [nowMs, statusInfo]);
  const isExpiringSoon = useMemo(() => {
    const d = daysRemaining;
    return typeof d === "number" && d <= 3 && d > 0;
  }, [daysRemaining]);
  const expireDate = statusInfo?.temporaryExpiresAt ? dayjs(statusInfo.temporaryExpiresAt).format("YYYY-MM-DD") : "";

  /* ─── 转正弹窗 ─── */
  const [convertDialog, setConvertDialog] = useState(false);
  const [convertLoading, setConvertLoading] = useState(false);
  const [convertForm, setConvertForm] = useState({
    enterpriseType: "有限责任公司",
    legalPerson: "",
    registeredAddress: "",
    businessScope: "",
    creditCode: "",
    contacts: [{ name: "", phone: "", email: "", position: "", isPrimary: true }] as ConvertContact[],
    qualifications: [] as ConvertQual[],
    tags: ["", ""] as string[],
  });

  function addTag() {
    setConvertForm((f) => (f.tags.length >= 8 ? f : { ...f, tags: [...f.tags, ""] }));
  }
  function removeTag(i: number) {
    setConvertForm((f) => (f.tags.length > 2 ? { ...f, tags: f.tags.filter((_, idx) => idx !== i) } : f));
  }
  function addContact() {
    setConvertForm((f) => ({ ...f, contacts: [...f.contacts, { name: "", phone: "", email: "", position: "", isPrimary: false }] }));
  }
  function removeContact(i: number) {
    setConvertForm((f) => (f.contacts.length > 1 ? { ...f, contacts: f.contacts.filter((_, idx) => idx !== i) } : f));
  }
  function addQualification() {
    setConvertForm((f) => ({ ...f, qualifications: [...f.qualifications, { type: "资质证书", name: "", fileUrl: "", validFrom: "", validTo: "" }] }));
  }
  function removeQualification(i: number) {
    setConvertForm((f) => ({ ...f, qualifications: f.qualifications.filter((_, idx) => idx !== i) }));
  }
  function onQualUploadSuccess(i: number, resp: any) {
    setConvertForm((f) => {
      const qs = [...f.qualifications];
      qs[i] = { ...qs[i], fileUrl: resp?.id || resp?.url || "" };
      return { ...f, qualifications: qs };
    });
    toast.success("资质材料上传成功");
  }

  async function openConvertDialog() {
    // 预填已有资料（临时注册时填的企业信息/联系人），避免重复填写；信用代码可在此修正
    try {
      const profile = await supplierApi.getProfile() as any;
      setConvertForm({
        enterpriseType: profile.enterpriseType || "有限责任公司",
        legalPerson: profile.legalPerson || "",
        registeredAddress: profile.registeredAddress || "",
        businessScope: profile.businessScope || "",
        creditCode: profile.creditCode || "",
        contacts: (profile.contacts && profile.contacts.length > 0)
          ? profile.contacts.map((c: any) => ({ name: c.name || "", phone: c.phone || "", email: c.email || "", position: c.position || "", isPrimary: !!c.isPrimary }))
          : [{ name: "", phone: "", email: "", position: "", isPrimary: true }],
        qualifications: [],
        tags: (profile.tags && profile.tags.length >= 2) ? [...profile.tags] : ["", ""],
      });
    } catch { /* 预填失败不阻塞打开弹窗 */ }
    setConvertDialog(true);
  }

  async function submitConvert() {
    const f = convertForm;
    if ([f.enterpriseType, f.legalPerson, f.registeredAddress, f.businessScope].some((v) => !v.trim())) { toast.warning("请填写完整企业信息"); return; }
    if (!/^[0-9A-Z]{18}$/.test(f.creditCode.trim())) { toast.warning("统一社会信用代码须为 18 位数字与大写字母"); return; }
    if (f.contacts.some((c) => !c.name.trim() || !c.phone.trim())) { toast.warning("请填写完整联系人信息"); return; }
    if (f.qualifications.length === 0) { toast.warning("请至少添加一项资质材料"); return; }
    if (f.qualifications.some((q) => !q.type || !q.name.trim())) { toast.warning("请填写完所有资质信息（类型与名称必填）"); return; }
    const filledTags = f.tags.filter((t) => t.trim());
    if (filledTags.length < 2) { toast.warning("请至少填写 2 个业务标签"); return; }
    setConvertLoading(true);
    try {
      const payload = {
        enterpriseType: f.enterpriseType,
        legalPerson: f.legalPerson.trim(),
        registeredAddress: f.registeredAddress.trim(),
        businessScope: f.businessScope.trim(),
        creditCode: f.creditCode.trim(),
        contacts: f.contacts.map((c) => ({ name: c.name.trim(), phone: c.phone.trim(), email: c.email.trim() || undefined, position: c.position.trim() || undefined, isPrimary: c.isPrimary })),
        qualifications: f.qualifications.map((q) => ({ type: q.type, name: q.name.trim(), fileUrl: q.fileUrl || undefined, validFrom: q.validFrom || undefined, validTo: q.validTo || undefined })),
        tags: filledTags,
      };
      await supplierApi.convertToRegular(payload as Parameters<typeof supplierApi.convertToRegular>[0]);
      toast.success("转正申请已提交，等待审核");
      setConvertDialog(false);
    } catch (e: any) {
      toast.error(e instanceof ApiError ? String((e.data as any)?.error || "提交失败") : "提交失败");
    } finally {
      setConvertLoading(false);
    }
  }

  const ringCircumference = 2 * Math.PI * 30;

  return (
    <div className="page-container">
      {/* Error */}
      {error && !loading ? (
        <div className="sp-error-block">
          <div className="sp-error-icon"><TriangleAlert size={22} strokeWidth={1.75} /></div>
          <div className="sp-error-text">数据加载失败</div>
          <div className="sp-error-desc">网络或服务异常，请稍后重试</div>
          <SpButton variant="primary" onClick={() => { void load(); }}>重新加载</SpButton>
        </div>
      ) : loading ? (
        /* Skeleton */
        <>
          <SkeletonCard lines={2} className="db-mb-20" />
          <div className="kpi-grid db-mb-20">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} lines={1} />)}
          </div>
          <div className="db-main-grid">
            <SkeletonCard lines={8} />
            <div className="db-col-stack">
              <SkeletonCard lines={5} />
              <SkeletonCard lines={4} />
            </div>
          </div>
        </>
      ) : statusInfo ? (
        <>
          {/* ═══════ Hero（问候卡，neumorphic） ═══════ */}
          <div className="page-hero db-hero">
            <div className="page-hero__row">
              <div className="page-hero__left">
                <div className="page-hero__icon"><Building2 size={20} /></div>
                <div>
                  {statusInfo.isTemporary ? <div className="page-hero__eyebrow">临时供应商</div> : null}
                  <h1 className="page-hero__title">{statusInfo.name}</h1>
                  <div className="page-hero__sub db-hero-sub">
                    <span className={`sp-status ${STATUS_TYPE[statusInfo.status] || "pending"}`}>{STATUS_LABEL[statusInfo.status] || statusInfo.status}</span>
                    {daysSinceReg ? <span className="db-hero-meta">入驻 {daysSinceReg} 天</span> : null}
                    {statusInfo.status === "PENDING" ? (
                      <span className="db-hero-hint">审核中 — 通常 3 个工作日内完成</span>
                    ) : statusInfo.status === "RETURNED" ? (
                      <span className="db-hero-hint warn">{statusInfo.returnReason || "资料被退回，请补正"}</span>
                    ) : null}
                    <ServerClock />
                  </div>
                </div>
              </div>
              {statusInfo.isTemporary ? (
                <div className="page-hero__right db-hero-right">
                  <div className="db-temp-banner">
                    <span className={`db-temp-countdown${isExpiringSoon ? " expiring" : ""}`}>
                      <Clock size={14} className="db-clock-ic" />
                      {expireDate} 到期 · 剩 <strong>{daysRemaining}</strong> 天
                    </span>
                    <button className="neu-btn-soft" onClick={() => { void openConvertDialog(); }}>转为正式供应商</button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* 供应商侧统一待办：由资料、项目、通知书与合同履约状态聚合 */}
          <section className="sp-module db-task-panel" aria-labelledby="supplier-task-title">
            <div className="sp-module-header">
              <div>
                <h2 id="supplier-task-title" className="sp-module-title">当前待办</h2>
                <p className="db-task-subtitle">按服务器标准时间和紧急程度排序</p>
              </div>
              <span className="db-task-count" aria-label={`共 ${currentTasks.length} 项待办`}>{currentTasks.length}</span>
            </div>
            {currentTasks.length === 0 ? (
              <div className="db-task-empty"><CheckCircle2 size={18} /> 暂无紧急事项</div>
            ) : (
              <div className="db-task-list">
                {currentTasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className={`db-task-item ${task.urgency}`}
                    onClick={() => router.push(task.href)}
                  >
                    <span className="db-task-main">
                      <span className="db-task-source">{task.source}</span>
                      <span className="db-task-title">{task.title}</span>
                      <span className="db-task-description">{task.description}</span>
                    </span>
                    <span className="db-task-action">
                      {task.dueAt ? dayjs(task.dueAt).format("MM-DD HH:mm") : "查看处理"}
                      <ArrowRight size={14} aria-hidden="true" />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* ═══════ Two-column body ═══════ */}
          <div className="db-body">
            {/* LEFT: bid projects */}
            <section className="sp-module db-panel-left">
              <div className="sp-module-header">
                <h2 className="sp-module-title">采购项目</h2>
                <button className="neu-btn-xs" onClick={() => router.push("/bids")}>全部<ArrowRight size={12} /></button>
              </div>
              {projectRows.length === 0 ? (
                <div className="sp-empty db-empty-pad">
                  <div className="sp-empty-icon"><Folder size={22} strokeWidth={1.75} /></div>
                  <div className="sp-empty-text">暂无采购项目</div>
                </div>
              ) : (
                <div className="db-list">
                  {projectRows.map((row, idx) => (
                    <button
                      key={row.project.id}
                      type="button"
                      className={`db-list-row ${row.urgency}${idx === projectRows.length - 1 ? " is-last" : ""}${row.project.stage === "SUBMIT" ? " submit-stage" : ""}`}
                      onClick={() => router.push(`/bids/${row.project.id}?from=list`)}
                    >
                      <div className="db-list-info">
                        <span className="db-list-name">{row.project.name}</span>
                        <span className="db-list-code">{row.project.projectCode}</span>
                      </div>
                      <div className="db-list-right">
                        <span
                          className="db-list-stage"
                          style={{ "--stage-c": STAGES.find((s) => s.key === row.project.stage)?.color || "#94a3b8" } as React.CSSProperties}
                        >
                          {STAGES.find((s) => s.key === row.project.stage)?.label || row.project.stage}
                        </span>
                        <span className={`db-list-dl ${row.urgency}`}>
                          {row.urgency === "past" ? "已截止" : row.urgency === "critical" ? `剩${row.daysLeft}天` : `${row.daysLeft}天`}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* RIGHT: profile + notifications stack */}
            <div className="db-right-stack">
              {/* RIGHT TOP: 资料完整度 */}
              <section className="sp-module db-panel-comp">
                <div className="sp-module-header">
                  <h2 className="sp-module-title">资料完善</h2>
                  <button className="neu-btn-xs" onClick={() => router.push("/profile")}>完善<ArrowRight size={12} /></button>
                </div>
                {/* Ring + total score */}
                <div className="db-comp-top">
                  <div className="db-comp-ring">
                    <svg width="72" height="72" viewBox="0 0 72 72">
                      <circle cx="36" cy="36" r="30" fill="none" stroke="var(--hairline)" strokeWidth="5" />
                      <circle
                        cx="36" cy="36" r="30"
                        fill="none"
                        stroke={profileScore >= 80 ? "var(--success)" : profileScore >= 50 ? "var(--warning)" : "var(--danger)"}
                        strokeWidth="5"
                        strokeLinecap="round"
                        strokeDasharray={`${ringCircumference * profileScore / 100} ${ringCircumference * (1 - profileScore / 100)}`}
                        transform="rotate(-90 36 36)"
                      />
                    </svg>
                    <span className="db-comp-score">{profileScore}<small>分</small></span>
                  </div>
                  <div className="db-comp-bars">
                    {completenessCats.map((cat) => (
                      <div key={cat.key} className="db-comp-bar-row" style={{ "--c": cat.color } as React.CSSProperties}>
                        <div className="db-comp-bar-head">
                          <span className="db-comp-bar-icon"><cat.icon size={13} /></span>
                          <span className="db-comp-bar-label">{cat.label}</span>
                          <span className="db-comp-bar-stat">{catStatLabel(cat)}</span>
                        </div>
                        <div className="db-comp-bar-track">
                          <div
                            className="db-comp-bar-fill"
                            style={{ width: cat.max > 0 ? `${(cat.score / cat.max) * 100}%` : "0%" }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Missing hints */}
                {completenessCats.some((c) => c.missing.length > 0) ? (
                  <div className="db-comp-missing">
                    {completenessCats.map((cat) => (
                      <span key={`m-${cat.key}`} style={{ "--c": cat.color } as React.CSSProperties}>
                        {cat.missing.map((m) => (
                          <button type="button" key={m} className="db-comp-missing-tag" onClick={() => router.push("/profile")}>
                            <span className="db-comp-missing-dot" />
                            {m}
                          </button>
                        ))}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="db-comp-done">
                    <CheckCircle2 /> 所有资料已完善
                  </div>
                )}
              </section>

              {/* RIGHT BOTTOM: notifications */}
              <section className="sp-module db-panel-msg">
                <div className="sp-module-header">
                  <h2 className="sp-module-title">最近消息</h2>
                  <button className="neu-btn-xs" onClick={() => router.push("/notifications")}>全部<ArrowRight size={12} /></button>
                </div>
                {notifFeed.length === 0 ? (
                  <div className="sp-empty db-empty-pad db-empty-pad--sm">
                    <div className="sp-empty-icon"><Bell size={22} strokeWidth={1.75} /></div>
                    <div className="sp-empty-text">暂无消息</div>
                  </div>
                ) : (
                  <div className="db-msg-list">
                    {notifFeed.map((n, idx) => (
                      <button
                        key={n.id}
                        type="button"
                        className={`db-msg-row${!n.isRead ? " unread" : ""}${idx === notifFeed.length - 1 ? " is-last" : ""}`}
                        onClick={() => openNotifDetail(n)}
                      >
                        <span className="db-msg-dot" style={{ "--c": n.color.dot, "--g": n.color.glow } as React.CSSProperties} />
                        <div className="db-msg-body">
                          <span className={`db-msg-title${!n.isRead ? " unread" : ""}`}>{n.title}</span>
                          {n.content ? <span className="db-msg-ct">{n.content}</span> : null}
                        </div>
                        <span className="db-msg-time">{dayjs(n.createdAt).format("MM-DD HH:mm")}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </>
      ) : null}

      {/* 临时供应商转正弹窗（完整表单：企业信息 + 联系人 + 资质材料） */}
      <SpDialog
        open={convertDialog}
        onClose={() => setConvertDialog(false)}
        title="转为正式供应商"
        width={680}
        footer={
          <>
            <SpButton onClick={() => setConvertDialog(false)}>取消</SpButton>
            <SpButton variant="primary" loading={convertLoading} onClick={() => { void submitConvert(); }}>提交转正申请</SpButton>
          </>
        }
      >
        <div className="cv-body">
          {/* ══ 企业信息 ══ */}
          <section className="cv-section">
            <h3 className="cv-sec-title">企业信息</h3>
            <p className="cv-sec-desc">企业名称不可修改；统一社会信用代码可在此修正（需审批）</p>
            <div className="cv-form">
              <div className="cv-form-item">
                <label>统一信用代码</label>
                <div className="cv-form-ctrl">
                  <SpInput
                    value={convertForm.creditCode}
                    maxLength={18}
                    placeholder="18 位统一社会信用代码 *"
                    onChange={(e) => setConvertForm((f) => ({ ...f, creditCode: e.target.value }))}
                  />
                </div>
              </div>
              <div className="cv-form-item">
                <label>企业类型</label>
                <div className="cv-form-ctrl">
                  <SpSelect
                    value={convertForm.enterpriseType}
                    style={{ width: "100%" }}
                    onChange={(e) => setConvertForm((f) => ({ ...f, enterpriseType: e.target.value }))}
                  >
                    {ENTERPRISE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </SpSelect>
                </div>
              </div>
              <div className="cv-form-item">
                <label>法定代表人</label>
                <div className="cv-form-ctrl">
                  <SpInput
                    value={convertForm.legalPerson}
                    placeholder="请输入法定代表人"
                    onChange={(e) => setConvertForm((f) => ({ ...f, legalPerson: e.target.value }))}
                  />
                </div>
              </div>
              <div className="cv-form-item">
                <label>注册地址</label>
                <div className="cv-form-ctrl">
                  <SpInput
                    value={convertForm.registeredAddress}
                    placeholder="请输入注册地址"
                    onChange={(e) => setConvertForm((f) => ({ ...f, registeredAddress: e.target.value }))}
                  />
                </div>
              </div>
              <div className="cv-form-item">
                <label>经营范围</label>
                <div className="cv-form-ctrl">
                  <SpTextarea
                    value={convertForm.businessScope}
                    placeholder="请输入经营范围"
                    onChange={(e) => setConvertForm((f) => ({ ...f, businessScope: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* ══ 业务标签 ══ */}
          <section className="cv-section">
            <div className="cv-sec-head">
              <h3 className="cv-sec-title">业务标签</h3>
              <span className="cv-sec-hint">使用2-8个词语简述并概括业务方向，每个单独填写</span>
              <SpButton variant="xs" disabled={convertForm.tags.length >= 8} onClick={addTag}>+ 添加标签</SpButton>
            </div>
            {convertForm.tags.map((t, i) => (
              <div key={`tag${i}`} className="cv-contact-row">
                <span className="cv-subrow-idx">{i + 1}</span>
                <SpInput
                  className="cv-ci-name"
                  value={t}
                  maxLength={20}
                  placeholder={i === 0 ? "如：办公用品" : i === 1 ? "如：钻机销售" : "请输入业务标签"}
                  onChange={(e) => setConvertForm((f) => {
                    const tags = [...f.tags];
                    tags[i] = e.target.value;
                    return { ...f, tags };
                  })}
                />
                {convertForm.tags.length > 2 ? (
                  <SpButton variant="xs" danger onClick={() => removeTag(i)}>删除</SpButton>
                ) : null}
              </div>
            ))}
          </section>

          {/* ══ 联系人 ══ */}
          <section className="cv-section">
            <div className="cv-sec-head">
              <h3 className="cv-sec-title">联系人信息</h3>
              <SpButton variant="xs" onClick={addContact}>+ 添加联系人</SpButton>
            </div>
            {convertForm.contacts.map((c, i) => (
              <div key={`ct${i}`} className="cv-contact-row">
                <span className="cv-subrow-idx">{i + 1}</span>
                <SpInput
                  className="cv-ci-name"
                  placeholder="姓名 *"
                  value={c.name}
                  onChange={(e) => setConvertForm((f) => {
                    const contacts = [...f.contacts];
                    contacts[i] = { ...contacts[i], name: e.target.value };
                    return { ...f, contacts };
                  })}
                />
                <SpInput
                  className="cv-ci-phone"
                  placeholder="手机号 *"
                  value={c.phone}
                  onChange={(e) => setConvertForm((f) => {
                    const contacts = [...f.contacts];
                    contacts[i] = { ...contacts[i], phone: e.target.value };
                    return { ...f, contacts };
                  })}
                />
                <SpInput
                  className="cv-ci-email"
                  placeholder="邮箱（选填）"
                  value={c.email}
                  onChange={(e) => setConvertForm((f) => {
                    const contacts = [...f.contacts];
                    contacts[i] = { ...contacts[i], email: e.target.value };
                    return { ...f, contacts };
                  })}
                />
                <SpInput
                  className="cv-ci-position"
                  placeholder="职位/职务"
                  value={c.position}
                  onChange={(e) => setConvertForm((f) => {
                    const contacts = [...f.contacts];
                    contacts[i] = { ...contacts[i], position: e.target.value };
                    return { ...f, contacts };
                  })}
                />
                <label className="cv-ci-switch">
                  <span className="cv-ci-switch-label">主要</span>
                  <SpSwitch
                    checked={c.isPrimary}
                    onChange={(v) => setConvertForm((f) => {
                      const contacts = [...f.contacts];
                      contacts[i] = { ...contacts[i], isPrimary: v };
                      return { ...f, contacts };
                    })}
                  />
                </label>
                {convertForm.contacts.length > 1 ? (
                  <SpButton variant="xs" danger onClick={() => removeContact(i)}>删除</SpButton>
                ) : null}
              </div>
            ))}
          </section>

          {/* ══ 资质材料 ══ */}
          <section className="cv-section">
            <div className="cv-sec-head">
              <h3 className="cv-sec-title">资质材料</h3>
              <SpButton variant="xs" onClick={addQualification}>+ 添加资质</SpButton>
            </div>
            {convertForm.qualifications.map((q, i) => (
              <div key={`ql${i}`} className="cv-qual-row">
                <span className="cv-subrow-idx">{i + 1}</span>
                <SpSelect
                  className="cv-qs-type"
                  value={q.type}
                  onChange={(e) => setConvertForm((f) => {
                    const qualifications = [...f.qualifications];
                    qualifications[i] = { ...qualifications[i], type: e.target.value };
                    return { ...f, qualifications };
                  })}
                >
                  {QUAL_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </SpSelect>
                <SpInput
                  className="cv-qs-name"
                  placeholder="资质名称 *"
                  value={q.name}
                  onChange={(e) => setConvertForm((f) => {
                    const qualifications = [...f.qualifications];
                    qualifications[i] = { ...qualifications[i], name: e.target.value };
                    return { ...f, qualifications };
                  })}
                />
                <SpDateInput
                  className="cv-qs-date"
                  placeholder="有效期起"
                  value={q.validFrom}
                  onChange={(e) => setConvertForm((f) => {
                    const qualifications = [...f.qualifications];
                    qualifications[i] = { ...qualifications[i], validFrom: e.target.value };
                    return { ...f, qualifications };
                  })}
                />
                <SpDateInput
                  className="cv-qs-date"
                  placeholder="有效期止"
                  value={q.validTo}
                  onChange={(e) => setConvertForm((f) => {
                    const qualifications = [...f.qualifications];
                    qualifications[i] = { ...qualifications[i], validTo: e.target.value };
                    return { ...f, qualifications };
                  })}
                />
                <label className="cv-upload">
                  <input
                    type="file"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.currentTarget.value = "";
                      if (file) {
                        uploadFile(file, "qualification")
                          .then((resp) => onQualUploadSuccess(i, resp))
                          .catch(() => { /* uploadFile 已全局 toast 错误 */ });
                      }
                    }}
                  />
                  <span className="neu-btn-xs">上传</span>
                </label>
                {q.fileUrl ? (
                  <a className="neu-btn-xs is-info" href={`/api/upload/files/${q.fileUrl}`} target="_blank" rel="noopener noreferrer">查看</a>
                ) : null}
                <SpButton variant="xs" danger onClick={() => removeQualification(i)}>删除</SpButton>
              </div>
            ))}
          </section>

          <p className="db-convert-hint">提交后需管理员审批，审批通过后自动转为正式供应商。</p>
        </div>
      </SpDialog>

      {/* 通知详情弹窗（cgzxui neumorphic） */}
      <SpDialog
        open={notifDetail !== null}
        onClose={() => setNotifDetail(null)}
        title={notifDetail?.title || "通知详情"}
        width={600}
        footer={
          <div className="nd-footer">
            {notifDetail && !notifDetail.isRead ? (
              <button
                className="nd-btn nd-btn--danger"
                onClick={() => {
                  const id = notifDetail.id;
                  setNotifDetail((d: any) => (d ? { ...d, isRead: true } : d));
                  markAsRead(id).catch(() => {});
                }}
              >
                标为已读
              </button>
            ) : null}
            <button className="nd-btn nd-btn--soft" onClick={() => setNotifDetail(null)}>关闭</button>
          </div>
        }
      >
        {notifDetail ? (
          <div className="nd-body">
            <span className="nd-time">{dayjs(notifDetail.createdAt).format("YYYY-MM-DD HH:mm")}</span>
            <div className="nd-content">{notifDetail.content}</div>
          </div>
        ) : null}
      </SpDialog>
    </div>
  );
}
