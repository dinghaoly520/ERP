"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import dayjs from "dayjs";
import {
  FileText, TriangleAlert, Lock, Upload, Download, Sparkles, Loader2, ArrowLeft,
  CircleX, CircleCheck, Info, KeyRound, Copy, Check, Coins, Trophy,
} from "lucide-react";
import { bidApi } from "@/lib/api/bid";
import { TenderClarificationCard } from "@/components/tender-clarification-card";
import { CaReceiptSignButton } from "@/components/ca-receipt-sign-button";
import { CountdownTimer } from "@/components/countdown-timer";
import { supplierApi } from "@/lib/api/supplier";
import { announcementApi } from "@/lib/api/announcement";
import { authedFileAction, saveBlob } from "@/lib/authed-file";
import { copyToClipboard } from "@/lib/copy-to-clipboard";
import { InvitationDocxPreview } from "@/components/invitation-docx-preview";
import { SpButton, SpInput, SpDialog, LoadingBlock } from "@/components/ui";
import { HelpTip } from "@/components/help-tip";
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

import { STAGE_LABEL } from "@water-erp/shared";

const STAGES = ["DOWNLOAD", "SUBMIT", "OPENING", "EVALUATING", "ARCHIVED"] as const;
// X-P2-03：label 收敛 @water-erp/shared STAGE_LABEL（消除「已归档/资料归档」漂移），补 ABORTED（流标徽标不再空白）
const stageMap: Record<string, { label: string; color: string; guide: string }> = {
  DOWNLOAD: { label: STAGE_LABEL.DOWNLOAD, color: "var(--bid-stage-download)", guide: "可下载采购文件、查看项目范围与资质要求，提前准备投标材料。" },
  SUBMIT: { label: STAGE_LABEL.SUBMIT, color: "var(--bid-stage-submit)", guide: "标书已开放投递，请在截止时间前完成标书文件加密上传与提交。" },
  OPENING: { label: STAGE_LABEL.OPENING, color: "var(--bid-stage-opening)", guide: "项目已进入开标流程，届时可在线参与开标确认，核实开标信息。" },
  EVALUATING: { label: STAGE_LABEL.EVALUATING, color: "var(--bid-stage-evaluating)", guide: "评标委员会正在对标书进行综合评审，请耐心等候评标结果公示。" },
  ABORTED: { label: STAGE_LABEL.ABORTED, color: "var(--danger)", guide: "本项目已流标，请留意平台后续公告或联系采购中心。" },
  ARCHIVED: { label: STAGE_LABEL.ARCHIVED, color: "var(--bid-stage-archived)", guide: "招投标流程已完成并归档，可查看最终评标结果与中标公示。" },
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
  // 异议联系方式（2026-09-11 互通）：与澄清说明同源，采购端在澄清说明页维护
  const [objectionContact, setObjectionContact] = useState("");

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

  // ── 招标文件要点（A-87）板块已按 2026-09-11 拍板移除（解析不可用造成长期空态）──

  // ── 谈判采购文件（2026-10-19 适应性）：详情页与列表行同源——后端 getBidProject 已富化
  //    negotiation 摘要（窗口/下载模式/文件数），谈判项目不再恒「暂无采购文件」
  const [negoLoading, setNegoLoading] = useState(false);
  const nego = (project as any)?.negotiation as {
    acquireStartTime: string | null; acquireEndTime: string | null;
    downloadMode: string; fileCount: number;
  } | null | undefined;
  /** 获取窗口状态（与列表页 negoWindowState 同口径，走服务器标准时钟） */
  const negoWinState = (() => {
    if (!nego) return null;
    const now = serverNowMs();
    const s = nego.acquireStartTime ? new Date(nego.acquireStartTime).getTime() : NaN;
    const e = nego.acquireEndTime ? new Date(nego.acquireEndTime).getTime() : NaN;
    if (!isNaN(s) && now < s) return "before" as const;
    if (!isNaN(e) && now > e) return "after" as const;
    return "open" as const;
  })();

  async function doDownloadNegotiation() {
    setNegoLoading(true);
    try {
      const res: any = await bidApi.getNegotiationFiles(projectId);
      if (!res.files || res.files.length === 0) {
        toast.warning("该项目暂无可下载的采购文件");
        return;
      }
      if (res.downloadMode === "encrypted" && res.password) {
        toast.info(`加密文件，访问密码：${res.password}`);
      } else if (res.downloadMode === "paid" && res.paidAmount) {
        toast.info(`付费文件，金额：¥${res.paidAmount}`);
      }
      // 全部经 authed-file 带 token 下载（窗口明示的「下载」动作无需新开预览标签，
      // 顺带规避单文件 window.open 在弹窗拦截/无头环境下的静默失败）
      const files = (res.files ?? []) as Array<{ url?: string; name?: string }>;
      for (const f of files) {
        if (f.url) authedFileAction(f.url, "download", f.name || undefined);
      }
      if (files.length > 0) toast.success(`已开始下载 ${files.length} 个采购文件`);
    } catch {
      /* API 层已全局错误 toast（窗口未开始/已截止/未受邀等后端文案） */
    } finally {
      setNegoLoading(false);
    }
  }

  // ── 投标回执（A-101）：已递交后查看 + U盾补签 ──
  const [submission, setSubmission] = useState<any>(null);
  const [receiptPayload, setReceiptPayload] = useState<Record<string, unknown> | null>(null);
  const [payloadLoading, setPayloadLoading] = useState(false);
  // P1-6：失败分类——unbound=未绑定 U盾证书（确定性失败，不可重试，面板给去绑定入口）；retry=网络/服务端瞬时故障
  const [payloadFailed, setPayloadFailed] = useState<"unbound" | "retry" | null>(null);
  // 核验面板：已签署时服务端重验签结论（A-101）+ 复制原文反馈
  const [receiptVerify, setReceiptVerify] = useState<{ signed: boolean; verified?: boolean; reason?: string } | null>(null);
  const [receiptVerifyFailed, setReceiptVerifyFailed] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [receiptCopied, setReceiptCopied] = useState(false);

  const isApproved = profile?.status === "APPROVED";
  // C12（第四波）：截止跨过后 canSubmit/阶段文案 30s 自动重算（旧实现不定时重算，页面停显「可投标」误导）
  const [, forceDeadlineTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceDeadlineTick((v) => v + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  // 截止预检走服务器标准时钟（本地时钟可篡改；未同步时 serverNowMs 退化本地时间，后端仍有截止闸门兜底）
  const canSubmit = !!project && isApproved
    && ["DOWNLOAD", "SUBMIT"].includes(project.stage)
    && new Date(project.deadline).getTime() > serverNowMs();
  // B4-1（2026-09-30）：去掉 Math.max 兜底——ABORTED（-1）曾被吞成 0，进度条把「下载中」
  // 点亮为当前阶段，与同卡下方 stage-msg 的「本项目已流标」自相矛盾；流标时各步全灰更准确
  const stageIdx = STAGES.indexOf((project?.stage || "DOWNLOAD") as (typeof STAGES)[number]);
  const showSupplierCount = ["OPENING", "EVALUATING", "ARCHIVED"].includes(project?.stage || "");
  const supplierCount = project?._count?.suppliers || 0;


  // ── 公告结构化信息（来自 announcement.metadata，仅展示有值字段）──
  const metaFields = (() => {
    const m = project?.announcement?.metadata || null;
    if (!m) return [] as { label: string; value: string; kind: 'code' | 'money' | 'date' | 'plain' }[];
    const fields: { label: string; value: string; kind: 'code' | 'money' | 'date' | 'plain' }[] = [];
    if (m.projectCode) fields.push({ label: "项目编号", value: m.projectCode, kind: 'code' });
    if (m.method) fields.push({ label: "采购方式", value: m.method, kind: 'plain' });
    if (m.budget != null && m.budget !== "") fields.push({ label: "预算金额", value: fmtBudget(m.budget), kind: 'money' });
    // 口径修正（2026-09-14）：投标截止以项目截标时间（BidProject.deadline）为准；
    // 公告 metadata.deadline 实为公示期止，仅项目无截标时间时兜底展示
    const bidDeadline = project?.deadline || m.deadline;
    if (bidDeadline) fields.push({ label: "投标截止", value: fmtMetaDate(bidDeadline), kind: 'date' });
    if (m.downloadDeadline) fields.push({ label: "采购文件下载截止", value: fmtMetaDate(m.downloadDeadline), kind: 'date' });
    if (m.downloadMode) fields.push({ label: "下载方式", value: m.downloadMode === "encrypted" ? "解密下载" : m.downloadMode === "paid" ? "付费下载" : "免费下载", kind: 'plain' });
    if (m.openTime) fields.push({ label: "开标时间", value: fmtMetaDate(m.openTime), kind: 'date' });
    if (m.contact) fields.push({ label: "联系方式", value: m.contact, kind: 'plain' });
    return fields;
  })();

  // SUP-P3-08：加载失败保留原因——此前一切失败折叠成「暂无采购文件」空态，
  // 截止已过/临时过期等 400 与「确实没有」不可区分
  const [bidDocError, setBidDocError] = useState<string | null>(null);

  // 项目结果（2026-10-23）：已完结项目的结果卡数据——outcome 仅归档/流标后非空
  const [outcome, setOutcome] = useState<any>(null);
  const loadOutcome = useCallback(async () => {
    try {
      setOutcome(await bidApi.getMyOutcome(projectId));
    } catch {
      setOutcome(null); // 结果卡静默降级——详情主体不受影响（API 层已全局提示）
    }
  }, [projectId]);
  const fmtAmount = (n: any) =>
    typeof n === "number" ? (n >= 10000 ? `${(n / 10000).toFixed(2)} 万元` : `${n} 元`) : "—";
  const OUTCOME_META: Record<string, { label: string; cls: string }> = {
    AWARDED: { label: "已中标", cls: "var(--success)" },
    PARTICIPATED: { label: "已投递 · 未中标", cls: "var(--warning)" },
    INVITED: { label: "受邀 · 未投递", cls: "var(--fg-3, gray)" },
    ABORTED: { label: "项目流标", cls: "var(--danger)" },
  };
  const loadBidDoc = useCallback(async () => {
    setBidDocLoading(true);
    setBidDocError(null);
    try {
      setBidDoc(await bidApi.getProjectBidDocument(projectId));
    } catch (e: any) {
      setBidDoc(null);
      setBidDocError(e?.message || "采购文件暂时无法获取，请稍后重试");
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
    try {
      const oc = await bidApi.getObjectionContact();
      setObjectionContact(oc?.value || "");
    } catch {
      setObjectionContact("");
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
      // 已完结项目（2026-10-23）：不再请求采购文件——下载截止闸对归档/流标项目必然 400，
      // 每次进详情弹「采购文件下载时间已截止」报错不合适；卡内改为终态说明。
      // SUP-P3-08 的失败保留语义继续服务进行中项目（截止/临时过期仍即时反馈）。
      if (p.stage === "ARCHIVED" || p.stage === "ABORTED") {
        setBidDoc(null);
        setBidDocError("项目已完结归档，采购文件获取窗口已结束");
      } else {
        loadBidDoc();
      }
      void loadOutcome();
      loadOverview();
      // A-101 回执卡：仅已入库（APPROVED）供应商拉本人递交记录——临时/待审供应商
      // 虽有 Supplier 行但尚未入库，无递交记录可展示（2026-09-28 修正注释：此前误写「临时供应商无 Supplier 行」）
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
      // 2026-10-19：落盘收口 saveBlob（旧内联「立即 revokeObjectURL」竞态致真实浏览器下载静默失败）
      await saveBlob(blob, fileName);
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
    // 投递页 = 旧版表单 UI + SCCA dual-v3 内核（2026-10-14 用户裁定：恢复旧前端设计、后端走 SCCA）
    router.push(`/bids/${projectId}/submit`);
  }

  // ══ A-101 回执展示与核验（U盾签署随 mock U盾轨下线，dual-v3 阶段恢复；服务端重验签为只读）══

  /** 未签署时展开「核验负载」→ 向服务端取回执负载（以 DB 为准重建；已签署直接看存档 payload）
   *  P1-6：silent 取回——未绑定证书（确定性失败）不再弹「无法签署回执」全局 toast，改面板内解释+去绑定入口 */
  async function loadReceiptPayload() {
    if (!submission || receiptPayload || payloadLoading) return;
    setPayloadLoading(true);
    setPayloadFailed(null);
    try {
      const r = await supplierApi.getReceiptPayload(submission.id, { silent: true });
      setReceiptPayload(r.payload);
    } catch (e: any) {
      const code = e?.code ?? (e?.data as Record<string, unknown> | undefined)?.code;
      const unbound = code === "SM2_PUBLIC_KEY_MISSING" || String(e?.message ?? "").includes("未绑定");
      if (unbound) {
        setPayloadFailed("unbound"); // 确定性失败：面板解释 + 去绑定，不弹 toast、不误导为可重试
      } else {
        setPayloadFailed("retry");
        toast.error(e?.message || "回执获取失败，请重新展开重试"); // 瞬时故障保留 toast 反馈（原全局 toast 同等语义）
      }
    }
    finally { setPayloadLoading(false); }
  }

  /** 已签署时展开「投递回执核验」→ 服务端对存档签名只读复验（A-101），面板内显示结论徽标；
   *  复验失败不弹 toast、不阻塞原文展示——徽标缺省为「暂不可用」 */
  async function loadReceiptVerify() {
    if (!submission || receiptVerify || verifying) return;
    setVerifying(true);
    try {
      const r = await supplierApi.verifyReceiptSignature(submission.id, { silent: true });
      setReceiptVerify(r);
    } catch {
      setReceiptVerifyFailed(true);
    } finally {
      setVerifying(false);
    }
  }

  async function copyReceiptText() {
    const payload = submission?.receiptSignature?.payload ?? receiptPayload;
    if (!payload) return;
    if (await copyToClipboard(JSON.stringify(payload, null, 2))) { setReceiptCopied(true); window.setTimeout(() => setReceiptCopied(false), 2000); }
    else toast.error("复制失败，请手动选择文本复制");
  }

  function fmtTime(t: string) {
    return t ? dayjs(t).format("YYYY-MM-DD HH:mm") : "—";
  }

  // 核验面板展示的负载（已签署=签名存档原文；未签署=服务端按 DB 重建）+ UTC 原文的本地时区对照
  const displayedReceiptPayload: Record<string, unknown> | null =
    submission?.receiptSignature?.payload ?? receiptPayload;
  const receivedAtLocal = displayedReceiptPayload?.receivedAt
    ? dayjs(String(displayedReceiptPayload.receivedAt)).format("YYYY-MM-DD HH:mm:ss")
    : "";
  // 时区显式标注（2026-09-14）：查看设备时区不同则对照时刻不同，标注偏移消除歧义
  const tzOffsetLabel = (() => {
    const minutes = -new Date().getTimezoneOffset();
    const sign = minutes >= 0 ? "+" : "-";
    const abs = Math.abs(minutes);
    return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  })();

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
              {/* ═══ 详情头（2026-10-19 重设计：弃 cgzxui page-hero 标题卡——实体详情页不套标题栏，
                  直接开篇：eyebrow 入口语境 + 项目名大标题 + 阶段徽标，坐在页面底色上）═══ */}
              <header className="bd-head">
                <div className="bd-eyebrow">{isListMode ? "项目机会" : "投标进展"} · 项目详情</div>
                <div className="bd-title-row">
                  <h1 className="bd-title">{project.name}</h1>
                  <span className="bd-stage" style={{ "--sc": stageMap[project.stage]?.color } as React.CSSProperties}>
                    <span className="bd-stage-dot" />
                    {stageMap[project.stage]?.label ?? project.stage}
                  </span>
                </div>
              </header>

              {/* ═══ 投标操作条（2026-10-19 重设计：内容区首卡）═══
                  cgzxui：并排主/次按钮 .neu-btn-group 统一等高；状态说明常驻卡内（原藏原生 title，触屏不可见）。
                  CountdownTimer 挂载即同步服务器时钟——canSubmit 预检同源（列表路径 info-bar 隐藏时不退化本地时钟） */}
              <div className="bid-act-card">
                <span className="bid-act-note">
                  {canSubmit ? (
                    <>
                      投标截止 <strong>{dayjs(project.deadline).format("MM-DD HH:mm")}</strong>
                      <CountdownTimer deadline={project.deadline} />
                    </>
                  ) : (
                    <>
                      <Lock size={13} strokeWidth={1.75} />
                      {!isApproved ? "供应商资料未审核通过，暂不可投标"
                        : !["DOWNLOAD", "SUBMIT"].includes(project?.stage || "") ? "项目不在投标期内（下载/递交阶段）"
                        : `投标截止时间已过（${dayjs(project.deadline).format("MM-DD HH:mm")} 截止）`}
                    </>
                  )}
                </span>
                <div className="neu-btn-group">
                  <button
                    type="button"
                    className="neu-btn-primary is-water"
                    disabled={!canSubmit}
                    onClick={goToSubmit}
                  >
                    {canSubmit
                      ? <Upload size={14} strokeWidth={1.75} />
                      : <Lock size={14} strokeWidth={1.75} />}
                    {canSubmit ? "提交标书" : "不可投标"}
                  </button>
                  {/* 2c: 多轮报价入口——仅谈判采购（roundMode=negotiation）；竞价采购 sealed_auction 为单轮唱标模式。
                      B4-1（2026-09-30）：加成员/参与门槛——非参与供应商点了只会看到 403 空态 */}
                  {project.roundMode === "negotiation" && (canSubmit || submission?.status === "submitted") && (
                    <button type="button" className="neu-btn-soft" onClick={() => router.push(`/bids/${projectId}/round-quote`)}>
                      <Coins size={14} strokeWidth={1.75} />多轮报价
                    </button>
                  )}
                </div>
              </div>

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
                  <span className="ml-auto"><ServerClock /></span>
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
                {/* 公告结构化信息（镜像信息发布中心 :3005——chip 瓷片 + 分类色） */}
                {metaFields.length > 0 && (
                  <div className="cc-meta">
                    {metaFields.map((f) => (
                      <span key={f.label} className={`cc-meta-chip ${f.kind === 'code' ? 'cc-meta-chip--code' : f.kind === 'money' ? 'cc-meta-chip--money' : f.kind === 'date' ? 'cc-meta-chip--date' : ''}`}>
                        <span className="cc-meta-label">{f.label}</span>
                        <span className="cc-meta-value">{f.value}</span>
                      </span>
                    ))}
                  </div>
                )}

                {/* 招标条件（招标范围已融入上方项目概览，此处不再单独展示）；
                    联系方式已在上方结构化信息条展示，此处不再重复 */}
                {(project.qualification || project.qualityRequirement) && (
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
                  </div>
                )}

                {project.announcement?.content ? (
                  <div className="cc-body" dangerouslySetInnerHTML={{ __html: formatContent(project.announcement.content) }} />
                ) : (project as any).invitationLetter?.kind === "file" ? (
                  /* 无公告（谈判/邀请采购以邀请书代替）：在线预览采购邀请书 DOCX 原文 */
                  <InvitationDocxPreview
                    url={(project as any).invitationLetter.url}
                    fileName={(project as any).invitationLetter.fileName}
                  />
                ) : (project as any).invitationLetter ? (
                  /* 无邀请书文件时次级回退：RSVP 回执摘要卡 */
                  <div className="cc-invitation">
                    <div className="cc-inv-head">
                      <span className="cc-inv-badge">采购邀请书</span>
                      <span className="cc-inv-title">{(project as any).invitationLetter.title}</span>
                      {(project as any).invitationLetter.expiresAt && (
                        <span className="cc-inv-exp">
                          回执有效期至 {dayjs((project as any).invitationLetter.expiresAt).format("YYYY-MM-DD HH:mm")}
                        </span>
                      )}
                    </div>
                    {(project as any).invitationLetter.summaryFields && (
                      <div className="cc-meta">
                        {Object.entries((project as any).invitationLetter.summaryFields as Record<string, string>).map(([k, v]) => (
                          <div key={k} className="cc-meta-item">
                            <span className="cc-meta-label">{k}</span>
                            <span className="cc-meta-value">{v}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="cc-inv-note">
                      请按邀请函要求参与本项目；报价与文件投递以本页时间为准。
                      <HelpTip text="如需再次确认或修改回执，可从消息通知中的邀请链接进入。" className="ml-1" />
                    </p>
                  </div>
                ) : (
                  <div className="cc-empty">
                    <FileText size={20} strokeWidth={1.75} />
                    {/* 谈判采购以邀请书代替公告——空态口径区分（2026-10-19 用户裁定） */}
                    <p>{project.roundMode === "negotiation" || project.procurementMethod === "谈判采购" ? "暂无邀请书" : "暂无公告正文"}</p>
                  </div>
                )}
              </div>

              {/* ═══ dual-v3 投递卡（阶段2 · I5 评审修复：挂载点）═══
                    capabilities 门控（CA_SUPPLIER_V3_ENABLED + ACTIVE SCCA 绑定）内置于 Section；
                    未开 v3/未绑盾渲染 null——旧轨用户不受影响 */}


              {/* ═══ 项目结果（2026-10-23）：已完结项目的结果卡——已完成列表此前只有行级结果，
                  详情页无结果区块且进页必弹下载截止报错；现终态说明 + 结果（中标/未中标/流标） */}
              {outcome?.outcome && (
                <div className="neu-card bottom-card" style={{ gridColumn: "1 / -1" }}>
                  <div className="bc-hd flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5">
                      <Trophy size={15} strokeWidth={1.85} style={{ color: OUTCOME_META[outcome.outcome]?.cls }} />
                      项目结果
                    </span>
                    <span
                      className="rounded-full px-2.5 py-1 text-xs font-semibold"
                      style={{
                        color: OUTCOME_META[outcome.outcome]?.cls,
                        background: `color-mix(in oklch, ${OUTCOME_META[outcome.outcome]?.cls} 12%, transparent)`,
                      }}
                    >
                      {OUTCOME_META[outcome.outcome]?.label}
                    </span>
                  </div>
                  {outcome.outcome === "ABORTED" ? (
                    <p className="cc-inv-note">该项目已流标归档，无中标结果。可前往「信息门户 → 公告」查看相关流标公示。</p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                      <div>
                        <p className="ov-time-label">中标金额</p>
                        <p className="font-mono font-semibold">{fmtAmount(outcome.awardAmount)}</p>
                      </div>
                      <div>
                        <p className="ov-time-label">我的名次</p>
                        <p className="font-mono font-semibold">
                          {outcome.disqualified ? `${outcome.myRank ?? "—"}（废标）` : (outcome.myRank ?? "—")}
                        </p>
                      </div>
                      <div>
                        <p className="ov-time-label">我的得分</p>
                        <p className="font-mono font-semibold">{outcome.myScore ?? "—"}</p>
                      </div>
                      <div>
                        <p className="ov-time-label">我的报价</p>
                        <p className="font-mono font-semibold">{fmtAmount(outcome.myBidPrice)}</p>
                      </div>
                      <div>
                        <p className="ov-time-label">投递 / 完结</p>
                        <p className="font-mono font-semibold">
                          {outcome.submittedAt ? dayjs(outcome.submittedAt).format("YYYY-MM-DD") : "—"}
                          {outcome.completedAt ? ` / ${dayjs(outcome.completedAt).format("YYYY-MM-DD")}` : ""}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ═══ 招标文件 + 书面交流 ═══
                  B2-1（2026-09-30）：不再按 isListMode 隐藏——「项目机会」列表与工作台均
                  带 ?from=list 进入，首次投标的供应商正是在这条主路径上需要下载采购文件、
                  发起澄清提问（后端提问闸恰要求「已获取招标文件」）；此前整块隐藏 = 主路径
                  断头。紧凑模式下仅保留阶段条/关键信息的隐藏。 */}
              {
                <div className="bottom-grid">
                  {/* 招标文件（谈判采购：走谈判配置变体——窗口/下载模式/文件数；其余走公告 BidDocument） */}
                  <div className="neu-card bottom-card">
                    <div className="bc-hd">采购文件</div>
                    {nego ? (
                      <>
                        <div className="bdoc">
                          <Lock size={14} strokeWidth={1.75} className="bdoc-icon" />
                          <span className="bdoc-name">谈判采购文件（共 {nego.fileCount} 个）</span>
                        </div>
                        <div className="bdoc-acts">
                          {nego.acquireStartTime && nego.acquireEndTime && (
                            <p className="cq-desc !mb-0">
                              获取窗口：{dayjs(nego.acquireStartTime).format("YYYY-MM-DD HH:mm")} ~ {dayjs(nego.acquireEndTime).format("YYYY-MM-DD HH:mm")}
                            </p>
                          )}
                          {negoWinState === "before" && <BAlert type="info" title="采购文件获取尚未开始，请于窗口开启后下载" />}
                          {negoWinState === "after" && <BAlert type="warning" title="采购文件获取已截止" />}
                          <SpButton
                            variant="primary"
                            icon={Download}
                            disabled={negoWinState !== "open" || negoLoading}
                            onClick={doDownloadNegotiation}
                          >
                            {negoLoading ? "下载中…" : negoWinState === "open" ? `下载采购文件（${nego.fileCount}）` : "暂不可下载"}
                          </SpButton>
                        </div>
                      </>
                    ) : bidDoc ? (
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
                                <SpButton variant="primary" disabled={downloading} icon={Download} onClick={doDownload}>下载采购文件</SpButton>
                              )}
                            </>
                          )}
                        </div>
                      </>
                    ) : bidDocLoading ? (
                      <LoadingBlock />
                    ) : (
                      <div className="bc-empty">{bidDocError ? `采购文件不可获取：${bidDocError}` : "暂无采购文件"}</div>
                    )}
                  </div>

                  {/* 澄清答疑（投标阶段只读；评标中寻址本司的澄清经「评标澄清答复」在线签名答复，A-143） */}
                  <div className="neu-card bottom-card">
                    <div className="bc-hd flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5">澄清答疑</span>
                      {["EVALUATING", "ARCHIVED"].includes(project.stage) && (
                        <Link href={`/bids/${projectId}/clarifications`} className="b-tag b-tag--warning">
                          评标澄清答复
                        </Link>
                      )}
                    </div>
                    {notice ? (
                      <div className="cq-notice" dangerouslySetInnerHTML={{ __html: notice }} />
                    ) : (
                      <p className="cq-desc">如需获取信息，请按采购文件载明的方式联系招标联系人（电话或书面来函）。</p>
                    )}
                    {objectionContact && (
                      <div className="cq-notice mt-2 rounded-[12px] px-3 py-2.5" style={{ background: 'color-mix(in oklch, var(--accent, #064ea2) 6%, transparent)' }}>
                        <span className="mr-1.5 text-[12px] font-bold" style={{ color: 'var(--accent, #064ea2)' }}>异议联系方式</span>
                        <div className="mt-1 text-[13px] leading-relaxed text-[var(--foreground)]" dangerouslySetInnerHTML={{ __html: objectionContact }} />
                      </div>
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
                  <TenderClarificationCard projectId={projectId} stage={project?.stage} deadline={project?.deadline} />

                  {/* ═══ 投标回执（A-101）：已递交后查看编号/递交时间/签名状态；U盾补签随 mock U盾轨下线（dual-v3 阶段恢复）═══ */}
                  {submission?.status === "submitted" && (
                    <div className="neu-card bottom-card">
                      <div className="bc-hd flex items-center justify-between">
                        <span className="inline-flex items-center gap-1.5">投标回执</span>
                        {submission.receiptSignature ? (
                          <span className="b-tag b-tag--success">已电子签名</span>
                        ) : (
                          <>
                            <span className="b-tag b-tag--warning">未签署</span>
                            <CaReceiptSignButton
                              projectId={projectId}
                              submissionId={submission.id}
                              onSigned={() => reloadSubmission()}
                            />
                          </>
                        )}
                      </div>
                      <div className="cc-meta mb-3">
                        <div className="cc-meta-item">
                          <span className="cc-meta-label">回执编号</span>
                          <span className="cc-meta-value mono">{submission.receiptNo || "待生成"}</span>
                        </div>
                        <div className="cc-meta-item">
                          <span className="cc-meta-label">递交时间</span>
                          <span className="cc-meta-value strong">{fmtTime(submission.submittedAt)}</span>
                        </div>
                        {/* 服务端权威提交时间（审计信任锚点）：与递交时间同源同刻，显性化防争议——争议时以本列为准 */}
                        <div className="cc-meta-item">
                          <span className="cc-meta-label">平台确认时间</span>
                          <span className="cc-meta-value mono">
                            {submission.serverSubmittedAt ? fmtTime(submission.serverSubmittedAt) : "—"}
                          </span>
                        </div>
                      </div>
                      {submission.receiptSignature && (
                        <div className="cq-sig">
                          <Lock size={12} strokeWidth={1.75} />
                          签名算法 {submission.receiptSignature.algorithm ?? "SM2/SM3"}
                          {submission.receiptSignature.verifiedAt
                            ? ` · 存档时已验签 ${dayjs(submission.receiptSignature.verifiedAt).format("YYYY-MM-DD HH:mm")}`
                            : ""}
                        </div>
                      )}
                      {/* 回执负载核验：已签署看签署存档 payload + 服务端重验签徽标；未签署展开时向服务端取（以 DB 为准重建） */}
                      <details
                        className="ov-notif"
                        onToggle={(e) => {
                          if (!e.currentTarget.open) return;
                          if (submission.receiptSignature) void loadReceiptVerify();
                          else void loadReceiptPayload();
                        }}
                      >
                        <summary>投递回执核验</summary>
                        <div className="ov-notif-body font-mono !text-xs !whitespace-pre-wrap">
                          {displayedReceiptPayload && (
                            <>
                              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 !whitespace-normal">
                                <span className="opacity-[0.72]">
                                  {submission.receiptSignature
                                    ? "以下为投递回执的存档原文（已由贵司 U盾 SM2/SM3 签名存档，任何字段改动都会导致验签失败），供完整性核验："
                                    : "以下为按服务端记录重建的待签回执负载原文（尚未签署），供核对："}
                                </span>
                              </div>
                              <div className="mb-1.5 flex flex-wrap items-center gap-2 !whitespace-normal">
                                {submission.receiptSignature && (
                                  verifying ? (
                                    <span className="b-tag b-tag--info">重验签中…</span>
                                  ) : receiptVerify ? (
                                    receiptVerify.verified ? (
                                      <span className="b-tag b-tag--success">重验签通过</span>
                                    ) : receiptVerify.reason === "SM2_PUBLIC_KEY_MISSING" ? (
                                      <span className="b-tag b-tag--warning">当前证书与签署时不一致，无法复验</span>
                                    ) : (
                                      <span className="b-tag b-tag--danger">重验签未通过（存档与签名不符）</span>
                                    )
                                  ) : receiptVerifyFailed ? (
                                    <span className="b-tag b-tag--info">重验签暂不可用（原文展示不受影响）</span>
                                  ) : null
                                )}
                                {receivedAtLocal && (
                                  <span className="opacity-[0.72]">receivedAt（本地时区 {tzOffsetLabel}）：{receivedAtLocal}</span>
                                )}
                              </div>
                            </>
                          )}
                          {displayedReceiptPayload
                            ? JSON.stringify(displayedReceiptPayload, null, 2)
                              : payloadLoading ? "正在获取回执信息…"
                            : payloadFailed === "unbound" ? (
                              <div className="!whitespace-normal">
                                <div>回执获取失败：尚未绑定 U盾 数字证书（此操作无法通过重试解决）。</div>
                                <div className="mt-2">
                                  <SpButton variant="primary" icon={KeyRound} onClick={() => router.push("/profile/ukey")}>
                                    去绑定 U盾
                                  </SpButton>
                                </div>
                              </div>
                            )
                            : payloadFailed === "retry" ? "回执获取失败，请重新展开重试"
                            : "展开后获取投递回执的存档信息"}
                          {displayedReceiptPayload && (
                            <>
                              <div className="mt-1.5 flex justify-end !whitespace-normal">
                                <SpButton variant="xs" icon={receiptCopied ? Check : Copy} onClick={copyReceiptText}>
                                  {receiptCopied ? "已复制" : "复制原文"}
                                </SpButton>
                              </div>
                              <div className="mt-1 !whitespace-normal opacity-[0.62]">
                                字段对照：projectId＝本项目 · supplierId＝贵司平台标识 · filesCommit＝投标文件集承诺哈希（SHA-256）· submissionId＝对应回执编号 {submission.receiptNo || "—"}
                              </div>
                            </>
                          )}
                        </div>
                      </details>
                    </div>
                  )}
                </div>
              }
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
