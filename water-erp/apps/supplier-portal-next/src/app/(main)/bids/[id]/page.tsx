"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import dayjs from "dayjs";
import {
  FileText, TriangleAlert, Lock, Upload, Download, Sparkles, Loader2, ArrowLeft,
  CircleX, CircleCheck, Info, KeyRound, ShieldCheck,
} from "lucide-react";
import { openUkey } from "@/utils/ukey-factory";
import type { UKeyAdapter } from "@water-erp/ukey";
import { bidApi } from "@/lib/api/bid";
import { TenderClarificationCard } from "@/components/tender-clarification-card";
import { supplierApi } from "@/lib/api/supplier";
import { announcementApi } from "@/lib/api/announcement";
import { SpPageHero } from "@/components/sp-page-hero";
import { SpButton, SpInput, SpDialog, LoadingBlock } from "@/components/ui";
import { ServerClock } from "@/components/server-clock";
import { serverNowMs } from "@water-erp/shared";
import "@/styles/pages/bids.css";

/** el-alert 的原生等价（EP 四色调 + show-icon） */
function BAlert({ type, title, children, style }: {
  type: "info" | "warning" | "success" | "error";
  title?: React.ReactNode;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const Icon = type === "error" ? CircleX : type === "warning" ? TriangleAlert : type === "success" ? CircleCheck : Info;
  return (
    <div className={`b-alert b-alert--${type}`} style={style}>
      <span className="b-alert-ico"><Icon size={15} strokeWidth={2} /></span>
      <div className="b-alert-body">
        {title !== undefined && <span className="b-alert-title">{title}</span>}
        {children}
      </div>
    </div>
  );
}

/** 服务端绑定记录（仅取补签所需公开字段）——与评标澄清答复页同源 */
interface ServerCertRow { certSn: string; bindingStatus: string }

/** 本地缓存的绑定证书序列号（U盾管理页绑定成功后写入；仅公开信息）——与 clarifications 页同源 */
function boundCertSn(): string {
  try {
    const raw = localStorage.getItem("supplier_ukey_bound");
    return raw ? (JSON.parse(raw)?.certSn ?? "") : "";
  } catch { return ""; }
}

const STAGES = ["DOWNLOAD", "SUBMIT", "OPENING", "EVALUATING", "ARCHIVED"] as const;
const stageMap: Record<string, { label: string; color: string; guide: string }> = {
  DOWNLOAD: { label: "文件下载", color: "#0891b2", guide: "可下载招标文件、查看项目范围与资质要求，提前准备投标材料。" },
  SUBMIT: { label: "加密投递", color: "#c00a6b", guide: "标书已开放投递，请在截止时间前完成标书文件加密上传与提交。" },
  OPENING: { label: "在线开标", color: "#d97706", guide: "项目已进入开标流程，届时可在线参与开标确认，核实开标信息。" },
  EVALUATING: { label: "专家评标", color: "#7c3aed", guide: "评标委员会正在对标书进行综合评审，请耐心等候评标结果公示。" },
  ARCHIVED: { label: "已归档", color: "#059669", guide: "招投标流程已完成并归档，可查看最终评标结果与中标公示。" },
};

function fmtBudget(raw: any): string {
  if (raw == null || raw === "") return "";
  const n = Number(raw);
  if (isNaN(n)) return String(raw);
  if (n >= 10000) return `${(n / 10000).toFixed(0)} 万元`;
  return `${n} 元`;
}
function fmtMetaDate(raw: any): string {
  if (!raw) return "";
  const d = dayjs(raw);
  return d.isValid() ? d.format("YYYY/MM/DD HH:mm") : String(raw);
}

/** 将纯文本公告格式化为 HTML（处理中文招标公告结构；已是 HTML 则原样返回） */
function formatContent(raw: string): string {
  if (!raw) return "";
  if (/<[a-zA-Z][^>]*>/.test(raw)) return raw;
  // 先按一、二、三级标题拆，其余为正文段落
  return raw
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t) return "";
      // 一级标题：一、 二、 三、...
      if (/^[一二三四五六七八九十]+、/.test(t)) return `<h2>${t}</h2>`;
      // 二级标题：X.X 如 2.1 、（一）（二）
      if (/^\d+\.\d+\s/.test(t)) return `<h3>${t}</h3>`;
      if (/^（[一二三四五六七八九十]+）/.test(t)) return `<h3>${t}</h3>`;
      // 正文段落
      return `<p>${t}</p>`;
    })
    .join("\n");
}

function BidDetailInner() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id as string;
  const sp = useSearchParams();
  const isListMode = sp.get("from") === "list";
  const backTo = isListMode ? "/bids" : "/my-bids";
  const backLabel = isListMode ? "返回可投标项目" : "返回投标进展";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [project, setProject] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [notice, setNotice] = useState("");

  // ── 招标文件 ──
  const [bidDoc, setBidDoc] = useState<any>(null);
  const [bidDocLoading, setBidDocLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [payDialog, setPayDialog] = useState(false);
  const [paymentRef, setPaymentRef] = useState("");
  const [pwdDialog, setPwdDialog] = useState(false);
  const [decryptPwd, setDecryptPwd] = useState("");

  // ── AI 融合概览（采购内容 + 通知内容 + 两个时间）──
  const [overview, setOverview] = useState<any>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);

  // ── 投标回执（A-101）：已递交后查看 + U盾补签 ──
  const [submission, setSubmission] = useState<any>(null);
  const [receiptPayload, setReceiptPayload] = useState<Record<string, unknown> | null>(null);
  const [payloadLoading, setPayloadLoading] = useState(false);
  const [signing, setSigning] = useState(false);

  // ── U盾会话（克隆 clarifications 页：口令仅内存持有，解锁一次覆盖本页回执补签）──
  const [ukeyAdapter, setUkeyAdapter] = useState<UKeyAdapter | null>(null);
  const [ukeyCertSn, setUkeyCertSn] = useState("");
  const [ukeyPassword, setUkeyPassword] = useState("");
  const [ukeyOpening, setUkeyOpening] = useState(false);
  const [ukeyDialogVisible, setUkeyDialogVisible] = useState(false);
  const pendingSignRef = useRef(false);
  /** U盾会话快照 ref——解锁后同一事件闭包内立即 doSignReceipt，useState 异步更新会读到空值 */
  const ukeySessionRef = useRef<{ adapter: UKeyAdapter; certSn: string } | null>(null);
  /** 平台 ACTIVE 绑定证书 SN（U盾内证书的兜底匹配；空 = 未绑定，补签时给出引导） */
  const [activeServerCertSn, setActiveServerCertSn] = useState("");

  const isApproved = profile?.status === "APPROVED";
  // 截止预检走服务器标准时钟（本地时钟可篡改；未同步时 serverNowMs 退化本地时间，后端仍有截止闸门兜底）
  const canSubmit = !!project && isApproved
    && ["DOWNLOAD", "SUBMIT"].includes(project.stage)
    && new Date(project.deadline).getTime() > serverNowMs();
  const stageIdx = Math.max(0, STAGES.indexOf((project?.stage || "DOWNLOAD") as (typeof STAGES)[number]));
  const showSupplierCount = ["OPENING", "EVALUATING", "ARCHIVED"].includes(project?.stage || "");
  const supplierCount = project?._count?.suppliers || 0;

  const pub = project?.announcement?.publishDate ? ` · ${dayjs(project.announcement.publishDate).format("YYYY-MM-DD")} 公告` : "";
  const heroSub = project ? `${project.projectCode} · ${project.procurementMethod}${pub}` : "";

  // ── 公告结构化信息（来自 announcement.metadata，仅展示有值字段）──
  const metaFields = (() => {
    const m = project?.announcement?.metadata || null;
    if (!m) return [] as { label: string; value: string; mono?: boolean; strong?: boolean }[];
    const fields: { label: string; value: string; mono?: boolean; strong?: boolean }[] = [];
    if (m.projectCode) fields.push({ label: "项目编号", value: m.projectCode, mono: true });
    if (m.method) fields.push({ label: "招标方式", value: m.method });
    if (m.budget != null && m.budget !== "") fields.push({ label: "预算金额", value: fmtBudget(m.budget), strong: true });
    if (m.deadline) fields.push({ label: "投标截止", value: fmtMetaDate(m.deadline), strong: true });
    if (m.downloadDeadline) fields.push({ label: "采购文件下载截止", value: fmtMetaDate(m.downloadDeadline), strong: true });
    if (m.downloadMode) fields.push({ label: "下载方式", value: m.downloadMode === "encrypted" ? "解密下载" : m.downloadMode === "paid" ? "付费下载" : "免费下载" });
    if (m.openTime) fields.push({ label: "开标时间", value: fmtMetaDate(m.openTime), strong: true });
    if (m.contact) fields.push({ label: "联系方式", value: m.contact });
    return fields;
  })();

  const loadBidDoc = useCallback(async () => {
    setBidDocLoading(true);
    try {
      setBidDoc(await bidApi.getProjectBidDocument(projectId));
    } catch {
      setBidDoc(null);
    }
    setBidDocLoading(false);
  }, [projectId]);

  /** 本人递交记录（A-101 回执卡数据；未递交返回 null） */
  const reloadSubmission = useCallback(async () => {
    try {
      setSubmission(await supplierApi.getBidSubmission(projectId));
    } catch {
      setSubmission(null); // API 层已全局错误 toast
    }
  }, [projectId]);

  async function loadNotice() {
    try {
      const r = await bidApi.getClarificationNotice();
      setNotice(r?.value || "");
    } catch {
      setNotice("");
    }
  }

  async function loadOverview() {
    setOverviewLoading(true);
    try {
      setOverview(await bidApi.getProjectOverview(projectId));
    } catch {
      /* 拦截器已提示 */
    } finally {
      setOverviewLoading(false);
    }
  }

  const loadAll = useCallback(async () => {
    setError(false);
    setLoading(true);
    try {
      const [p, prof] = await Promise.all([
        bidApi.getProject(projectId),
        supplierApi.getProfile(),
        loadNotice(),
      ]);
      setProject(p);
      setProfile(prof);
      loadBidDoc();
      loadOverview();
      // A-101 回执卡：仅已入库供应商拉本人递交记录（临时供应商无 Supplier 行，跳过避免噪音）
      if (prof?.status === "APPROVED") void reloadSubmission();
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [projectId, loadBidDoc, reloadSubmission]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // 平台绑定证书（供 U盾内证书匹配；失败不阻塞浏览，补签时按解锁结果报错）——与 clarifications 页同源
  useEffect(() => {
    if (submission?.status !== "submitted") return;
    supplierApi.listMyCerts()
      .then((rows: ServerCertRow[]) => {
        const cert = rows.find((r) => r.bindingStatus === "ACTIVE");
        if (cert) setActiveServerCertSn(cert.certSn);
      })
      .catch(() => { /* 列表加载失败已全局 toast；解锁时兜底报错 */ });
  }, [submission?.status]);

  async function doPay() {
    if (!bidDoc?.announcementId) return;
    setPaying(true);
    try {
      await announcementApi.payBidDocument(bidDoc.announcementId, paymentRef || undefined);
      toast.success("付款凭证已提交");
      setPayDialog(false);
      setPaymentRef("");
      await loadBidDoc();
    } catch {
      /* API 层已全局错误 toast */
    }
    setPaying(false);
  }

  async function doDownload() {
    if (!bidDoc?.announcementId) return;
    setDownloading(true);
    try {
      const { blob, fileName } = await announcementApi.downloadBidDocument(bidDoc.announcementId, decryptPwd || undefined);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      setDecryptPwd("");
      setPwdDialog(false);
      await loadBidDoc();
    } catch (e: any) {
      toast.error(e?.message || "下载失败");
    }
    setDownloading(false);
  }

  function goToSubmit() {
    if (!profile || profile?.status !== "APPROVED") {
      toast.warning("只有已入库供应商可以提交标书");
      return;
    }
    router.push(isListMode ? `/bids/${projectId}/submit?from=list` : `/bids/${projectId}/submit`);
  }

  // ══ A-101 回执补签（序列克隆自 clarifications 页）══

  function handleSignReceipt() {
    if (!ukeyAdapter) {
      // 先解锁 U盾（口令对话框），解锁成功后凭 pendingSignRef 自动续签——与 clarifications 页同序列
      pendingSignRef.current = true;
      setUkeyPassword("");
      setUkeyDialogVisible(true);
      return;
    }
    void doSignReceipt();
  }

  /** 口令确认 → 解锁 U盾 → 选定平台绑定证书 → 续跑挂起的补签 */
  async function handleUkeyOpen() {
    if (!ukeyPassword) { toast.warning("请输入证书口令"); return; }
    setUkeyOpening(true);
    try {
      const { adapter } = await openUkey(ukeyPassword);
      const certs = await adapter.listCertificates();
      // 选中平台已绑定证书：优先本地缓存的 certSn（U盾管理页绑定后写入），兜底服务端 ACTIVE 绑定记录
      const cert = certs.find((c) => c.certSn === boundCertSn()) || certs.find((c) => c.certSn === activeServerCertSn);
      if (!cert) throw new Error("U盾内未找到与平台绑定的证书，请先到「U盾管理」页绑定");
      setUkeyAdapter(adapter);
      setUkeyCertSn(cert.certSn);
      ukeySessionRef.current = { adapter, certSn: cert.certSn };
      setUkeyPassword("");
      setUkeyDialogVisible(false);
      toast.success(`U盾已解锁（${cert.certSn}）`);
      if (pendingSignRef.current) { pendingSignRef.current = false; await doSignReceipt(); }
    } catch (e: any) {
      toast.error(e?.message || "U盾解锁失败");
    } finally {
      setUkeyOpening(false);
    }
  }

  /** 取 canonical → U盾签名 → 提交（幂等：服务端已签返回原行，刷新后按已签署展示） */
  async function doSignReceipt() {
    const session = ukeySessionRef.current;
    if (!submission || !session) return;
    setSigning(true);
    try {
      const { canonical } = await supplierApi.getReceiptPayload(submission.id);
      const signature = await session.adapter.sign(session.certSn, canonical);
      await supplierApi.signReceiptSignature(submission.id, signature);
      toast.success("回执已签署");
      await reloadSubmission();
    } catch (e: any) {
      const code = e?.code ?? (e?.data as Record<string, unknown> | undefined)?.code;
      if (code === "SM2_PUBLIC_KEY_MISSING") toast.error("请先在「U盾管理」页绑定数字证书");
      else if (code === "RECEIPT_SIGNATURE_INVALID") toast.error("回执验签失败，请重试");
      else if (!e?.status && e?.message) toast.error(e.message); // 本地签名异常兜底；403 等已由 API 层全局 toast
    } finally {
      setSigning(false);
    }
  }

  /** 未签署时展开「核验负载」→ 向服务端取回执负载（以 DB 为准重建；已签署直接看存档 payload） */
  async function loadReceiptPayload() {
    if (!submission || receiptPayload || payloadLoading) return;
    setPayloadLoading(true);
    try {
      const r = await supplierApi.getReceiptPayload(submission.id);
      setReceiptPayload(r.payload);
    } catch { /* API 层已全局错误 toast（含 SM2_PUBLIC_KEY_MISSING 绑定引导） */ }
    finally { setPayloadLoading(false); }
  }

  function fmtTime(t: string) {
    return t ? dayjs(t).format("YYYY-MM-DD HH:mm") : "—";
  }

  return (
    <div className="page-container">
      {loading ? (
        <LoadingBlock />
      ) : (
        <>
          <button type="button" className="neu-link back-link" onClick={() => router.push(backTo)}>
            <ArrowLeft size={14} strokeWidth={1.85} />{backLabel}
          </button>

          {error ? (
            <div className="sp-error-block">
              <div className="sp-error-icon"><TriangleAlert size={22} strokeWidth={1.75} /></div>
              <div className="sp-error-text">数据加载失败</div>
              <div className="sp-error-desc">网络或服务异常，请稍后重试</div>
              <SpButton variant="primary" onClick={loadAll}>重新加载</SpButton>
            </div>
          ) : project ? (
            <>
              {/* ═══ Hero ═══ */}
              <SpPageHero icon={FileText} title={project.name} sub={heroSub}
                actions={
                  <>
                    <button type="button" className="neu-btn-primary" disabled={!canSubmit} onClick={goToSubmit} style={{ height: 40, padding: "0 20px" }}>
                      <Upload size={14} strokeWidth={1.75} />{canSubmit ? "提交标书" : "不可投标"}
                    </button>
                    {/* 2c: 多轮报价入口——仅谈判采购（roundMode=negotiation）；竞价采购 sealed_auction 为单轮唱标模式 */}
                    {project.roundMode === "negotiation" && (
                      <button type="button" className="neu-btn-soft" onClick={() => router.push(`/bids/${projectId}/round-quote`)} style={{ height: 40, padding: "0 20px" }}>
                        多轮报价
                      </button>
                    )}
                  </>
                }
              />

              {/* ═══ 阶段进度 + 指引（非列表模式）═══ */}
              {!isListMode && (
                <div className="stage-card">
                  <div className="stage-bar">
                    {STAGES.map((key, i) => (
                      <div key={key} className={`sb ${i < stageIdx ? "done" : ""} ${i === stageIdx ? "cur" : ""}`} style={{ "--sc": stageMap[key].color } as React.CSSProperties}>
                        <span className="sb-dot" /><span className="sb-lbl">{stageMap[key].label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="stage-msg" style={{ "--sc": stageMap[project.stage]?.color || "var(--brand)" } as React.CSSProperties}>
                    <span className="sm-badge"><span className="sm-dot" />{stageMap[project.stage]?.label}</span>
                    <span className="sm-text">{stageMap[project.stage]?.guide || ""}</span>
                  </div>
                </div>
              )}

              {/* ═══ 关键信息（非列表模式）═══ */}
              {!isListMode && (
                <div className="info-bar">
                  <span>截止<strong className={project.stage === "SUBMIT" ? "danger" : undefined}>{dayjs(project.deadline).format("MM-DD HH:mm")}</strong></span>
                  <span>开标<strong>{dayjs(project.openTime).format("MM-DD HH:mm")}</strong></span>
                  <span>保证金<strong>{project.bondRequired && project.bondAmount ? "¥" + Number(project.bondAmount).toLocaleString() : "无"}</strong></span>
                  {showSupplierCount && <span>投标方<strong>{supplierCount} 家</strong></span>}
                  {/* A-98：服务器标准时间常显（截止预检/倒计时同源 /api/time） */}
                  <span style={{ marginLeft: "auto" }}><ServerClock /></span>
                </div>
              )}

              {/* ═══ AI 融合概览（采购内容 + 通知 + 两个时间）═══ */}
              <div className="overview-card neu-card">
                <div className="ov-head">
                  <span className="ov-head-icon"><Sparkles size={16} strokeWidth={1.75} /></span>
                  <h3>项目概览</h3>
                </div>
                {overviewLoading ? (
                  <div className="ov-loading"><Loader2 size={18} className="is-loading" /><span>正在生成项目概览…</span></div>
                ) : overview ? (
                  <>
                    <p className="ov-text">{overview.overview}</p>
                    {/* 两个时间 */}
                    {(overview.acquireStartTime || overview.bidOpeningTime) && (
                      <div className="ov-times">
                        {overview.acquireStartTime && (
                          <div className="ov-time-item">
                            <span className="ov-time-label">采购文件获取</span>
                            <span className="ov-time-val">{fmtTime(overview.acquireStartTime)} ~ {fmtTime(overview.acquireEndTime)}</span>
                          </div>
                        )}
                        {overview.bidOpeningTime && (
                          <div className="ov-time-item">
                            <span className="ov-time-label">开标时间</span>
                            <span className="ov-time-val">{fmtTime(overview.bidOpeningTime)}</span>
                          </div>
                        )}
                      </div>
                    )}
                    {/* 通知原文 */}
                    {overview.notification && (
                      <details className="ov-notif">
                        <summary>查看邀请通知原文</summary>
                        <div className="ov-notif-body">{overview.notification}</div>
                      </details>
                    )}
                  </>
                ) : null}
              </div>

              {/* ═══ 公告正文 ═══ */}
              <div className="content-card neu-card">
                {/* 公告结构化信息（镜像信息发布中心） */}
                {metaFields.length > 0 && (
                  <div className="cc-meta">
                    {metaFields.map((f) => (
                      <div key={f.label} className="cc-meta-item">
                        <span className="cc-meta-label">{f.label}</span>
                        <span className={`cc-meta-value ${f.mono ? "mono" : ""} ${f.strong ? "strong" : ""}`}>{f.value}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* 招标条件（招标范围已融入上方项目概览，此处不再单独展示） */}
                {(project.qualification || project.contact || project.qualityRequirement) && (
                  <div className="cc-conds">
                    {project.qualification && (
                      <div className="cc-cond">
                        <span className="cc-cond-hd">资质要求</span>
                        <p className="cc-cond-bd">{project.qualification}</p>
                      </div>
                    )}
                    {project.qualityRequirement && (
                      <div className="cc-cond">
                        <span className="cc-cond-hd">质量要求</span>
                        <p className="cc-cond-bd">{project.qualityRequirement}</p>
                      </div>
                    )}
                    {project.contact && (
                      <div className="cc-cond">
                        <span className="cc-cond-hd">联系方式</span>
                        <p className="cc-cond-bd">{project.contact}</p>
                      </div>
                    )}
                  </div>
                )}

                {project.announcement?.content ? (
                  <div className="cc-body" dangerouslySetInnerHTML={{ __html: formatContent(project.announcement.content) }} />
                ) : (
                  <div className="cc-empty">
                    <FileText size={20} strokeWidth={1.75} />
                    <p>暂无公告正文</p>
                  </div>
                )}
              </div>

              {/* ═══ 招标文件 + 书面交流（非列表模式）═══ */}
              {!isListMode && (
                <div className="bottom-grid">
                  {/* 招标文件 */}
                  <div className="neu-card bottom-card">
                    <div className="bc-hd">招标文件</div>
                    {bidDoc ? (
                      <>
                        <div className="bdoc">
                          <Lock size={14} strokeWidth={1.75} className="bdoc-icon" />
                          <span className="bdoc-name">{bidDoc.title}</span>
                        </div>
                        <div className="bdoc-acts">
                          {!bidDoc.eligible ? (
                            <BAlert type="error" title={"无法下载：" + bidDoc.reason} />
                          ) : (
                            <>
                              {bidDoc.needPayment && <BAlert type="warning" title="需付费下载" />}
                              {!bidDoc.needPayment && bidDoc.requirePayment && !bidDoc.paid && <BAlert type="info" title="付款凭证已提交，等待确认" />}
                              {bidDoc.needPayment && <SpButton variant="soft" onClick={() => setPayDialog(true)}>提交付款凭证</SpButton>}
                              {bidDoc.needPassword && <BAlert type="warning" title="需输入下载密码" />}
                              {bidDoc.needPassword && <SpButton variant="soft" onClick={() => setPwdDialog(true)}>输入下载密码</SpButton>}
                              {bidDoc.canDownload && (
                                <SpButton variant="primary" disabled={downloading} icon={Download} onClick={doDownload}>下载招标文件</SpButton>
                              )}
                            </>
                          )}
                        </div>
                      </>
                    ) : bidDocLoading ? (
                      <LoadingBlock />
                    ) : (
                      <div className="bc-empty">暂无招标文件</div>
                    )}
                  </div>

                  {/* 澄清答疑（投标阶段只读；评标中寻址本司的澄清经「评标澄清答复」在线签名答复，A-143） */}
                  <div className="neu-card bottom-card">
                    <div className="bc-hd flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5">澄清答疑</span>
                      {["EVALUATING", "ARCHIVED"].includes(project.stage) && (
                        <Link href={`/bids/${projectId}/clarifications`} className="b-tag b-tag--warning">
                          评标澄清答复（A-143）
                        </Link>
                      )}
                    </div>
                    {notice ? (
                      <div className="cq-notice" dangerouslySetInnerHTML={{ __html: notice }} />
                    ) : (
                      <p className="cq-desc">如需获取信息，请按招标文件载明的方式，拨打招标联系人电话或以书面来函提交。</p>
                    )}
                    {project.clarifications?.length ? (
                      <div className="cq-list">
                        {project.clarifications.map((c: any) => (
                          <div key={c.id} className="cq-item">
                            <div className="cq-head">
                              <span className={`b-tag ${c.type === "question" ? "b-tag--info" : "b-tag--warning"}`}>{c.type === "question" ? "答疑" : "澄清"}</span>
                              <span className="cq-issuer">{c.issuer}</span>
                              <span className="cq-time">{dayjs(c.createdAt).format("MM-DD HH:mm")}</span>
                            </div>
                            <div className="cq-text">{c.question}</div>
                            {c.reply && (
                              <div className="cq-reply"><span className="b-tag b-tag--success">回复</span><span>{c.reply}</span></div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="bc-empty">暂无澄清/答疑记录</div>
                    )}
                  </div>

                  {/* W1（A-80~86）：澄清与修改——提问 + 澄清文件下载（区别于上方评标澄清答疑只读区） */}
                  <TenderClarificationCard projectId={projectId} />

                  {/* ═══ 投标回执（A-101）：已递交后查看编号/递交时间/签名状态，未签署 U盾补签 ═══ */}
                  {submission?.status === "submitted" && (
                    <div className="neu-card bottom-card">
                      <div className="bc-hd flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5">投标回执</span>
                        {submission.receiptSignature ? (
                          <span className="b-tag b-tag--success">已电子签名</span>
                        ) : (
                          <span className="b-tag b-tag--warning">未签署</span>
                        )}
                      </div>
                      <div className="cc-meta" style={{ marginBottom: 12 }}>
                        <div className="cc-meta-item">
                          <span className="cc-meta-label">回执编号</span>
                          <span className="cc-meta-value mono">{submission.receiptNo || "待生成"}</span>
                        </div>
                        <div className="cc-meta-item">
                          <span className="cc-meta-label">递交时间</span>
                          <span className="cc-meta-value strong">{fmtTime(submission.submittedAt)}</span>
                        </div>
                      </div>
                      {submission.receiptSignature ? (
                        <div className="cq-sig">
                          <Lock size={12} strokeWidth={1.75} />
                          已电子签名（{submission.receiptSignature.algorithm ?? "SM2/SM3"}
                          {submission.receiptSignature.verifiedAt
                            ? ` · 验签 ${dayjs(submission.receiptSignature.verifiedAt).format("YYYY-MM-DD HH:mm")}`
                            : ""}）
                        </div>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <SpButton variant="primary" icon={ShieldCheck} loading={signing} onClick={handleSignReceipt}>
                            签署回执（U盾）
                          </SpButton>
                          {ukeyAdapter && (
                            <span className="cq-actions-hint">U盾已解锁（{ukeyCertSn}）</span>
                          )}
                        </div>
                      )}
                      {/* 回执负载核验：已签署看签署存档 payload，未签署展开时向服务端取（以 DB 为准重建） */}
                      <details
                        className="ov-notif"
                        onToggle={(e) => {
                          if (e.currentTarget.open && !submission.receiptSignature) void loadReceiptPayload();
                        }}
                      >
                        <summary>核验回执负载（JSON）</summary>
                        <div
                          className="ov-notif-body"
                          style={{
                            fontFamily: "'SF Mono', 'JetBrains Mono', monospace",
                            fontSize: 12,
                            whiteSpace: "pre-wrap",
                          }}
                        >
                          {submission.receiptSignature?.payload
                            ? JSON.stringify(submission.receiptSignature.payload, null, 2)
                            : receiptPayload
                              ? JSON.stringify(receiptPayload, null, 2)
                              : payloadLoading ? "正在获取回执负载…" : "回执负载获取失败"}
                        </div>
                      </details>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : null}
        </>
      )}

      {/* 付款凭证弹窗 */}
      <SpDialog open={payDialog} onClose={() => setPayDialog(false)} title="提交付款凭证" width={420}
        footer={
          <>
            <SpButton variant="soft" onClick={() => setPayDialog(false)}>取消</SpButton>
            <SpButton variant="primary" loading={paying} onClick={doPay}>提交</SpButton>
          </>
        }
      >
        <div className="b-dialog-field">
          <span>付款凭证/流水号</span>
          <SpInput value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)} placeholder="如：银行流水号" />
        </div>
      </SpDialog>

      {/* 下载密码弹窗 */}
      <SpDialog open={pwdDialog} onClose={() => setPwdDialog(false)} title="输入下载密码" width={380}
        footer={
          <>
            <SpButton variant="soft" onClick={() => setPwdDialog(false)}>取消</SpButton>
            <SpButton
              variant="primary"
              onClick={() => {
                setPwdDialog(false);
                doDownload();
              }}
            >
              确认下载
            </SpButton>
          </>
        }
      >
        <div className="b-dialog-field">
          <span>下载密码</span>
          <SpInput value={decryptPwd} maxLength={10} onChange={(e) => setDecryptPwd(e.target.value)} placeholder="请输入6位下载密码" />
        </div>
      </SpDialog>

      {/* ═══ U盾口令对话框（克隆 clarifications 页：解锁后自动续跑挂起的回执补签，A-101）═══ */}
      <SpDialog
        open={ukeyDialogVisible}
        onClose={() => setUkeyDialogVisible(false)}
        title="证书口令验证"
        subtitle="投标回执补签需解锁 U盾证书完成电子签名"
        icon={KeyRound}
        width={420}
        footer={
          <>
            <SpButton variant="soft" onClick={() => setUkeyDialogVisible(false)}>取消</SpButton>
            <SpButton variant="primary" loading={ukeyOpening} onClick={handleUkeyOpen}>解锁并签名</SpButton>
          </>
        }
      >
        <p className="cq-pin-hint">
          即将对本标书递交回执（服务端重建的规范化负载，含文件指纹与接收时间）进行 U盾电子签名，签署后归档留痕。
        </p>
        <label className="reg-label">证书口令</label>
        <SpInput
          type="password"
          value={ukeyPassword}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUkeyPassword(e.target.value)}
          placeholder="输入证书口令"
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") void handleUkeyOpen(); }}
        />
        <p className="text-xs mt-3 text-[var(--fg-2)]">口令仅本次会话使用，不会保存。</p>
      </SpDialog>
    </div>
  );
}

/** 项目详情 + AI 融合概览 + 招标文件下载（useSearchParams 需 Suspense 包裹） */
export default function BidDetailPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <BidDetailInner />
    </Suspense>
  );
}
