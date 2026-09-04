"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import dayjs from "dayjs";
import { ClipboardList, TriangleAlert, Plus } from "lucide-react";
import { supplierApi } from "@/lib/api/supplier";
import { SpPageHero } from "@/components/sp-page-hero";
import { SpButton } from "@/components/ui";
import "@/styles/pages/bids.css";
import "@/styles/pages/shared.css"; // 卡片三件套/骨架屏基座（2026-09-02 去重抽出，跨页共用）

const STAGES = [
  { key: "DOWNLOAD", label: "文件下载", color: "#0891b2" },
  { key: "SUBMIT", label: "加密投递", color: "#c00a6b" },
  { key: "OPENING", label: "在线开标", color: "#d97706" },
  { key: "EVALUATING", label: "专家评标", color: "#7c3aed" },
  { key: "ARCHIVED", label: "已归档", color: "#059669" },
] as const;

function stageIdx(stage: string): number {
  return STAGES.findIndex((s) => s.key === stage);
}

function stageColor(stage: string): string {
  return STAGES.find((s) => s.key === stage)?.color || "#94a3b8";
}

// ── Status helpers ──
const statusMap: Record<string, { label: string; cls: string }> = {
  draft: { label: "草稿", cls: "draft" },
  submitted: { label: "已提交", cls: "submitted" },
  withdrawn: { label: "已撤回", cls: "disabled" },
};

// bidPrice 存为字符串，可能填了"万元"也可能误填了"元"。统一格式化：
// ≥10000 视为元 → 自动换算万元；否则直接作为万元展示。
function formatBidPrice(raw: string | number | null | undefined): string {
  const n = Number(raw);
  if (!raw || isNaN(n)) return "--";
  if (n >= 10000) return `${(n / 10000).toFixed(2)} 万元`;
  return `${n} 万元`;
}

function canWithdraw(row: any) {
  return row.status === "submitted" && ["DOWNLOAD", "SUBMIT"].includes(row.project?.stage);
}
// U4：开标确认入口仅开标阶段开放——EVALUATING/ARCHIVED 再进大厅只有灰字（死胡同）
function canConfirmOpening(row: any) {
  return row.status === "submitted"
    && row.project?.stage === "OPENING"
    && row.confirmStatus !== "CONFIRMED";
}
// U4：stage 已过 OPENING 且仍未确认（confirmStatus 为 BidSupplier 枚举 PENDING/DISPUTED/EXCEPTION 之一）→ 只读提示
function overdueUnconfirmed(row: any) {
  if (row.status !== "submitted" || !row.confirmStatus) return false;
  const idx = stageIdx(row.project?.stage ?? "");
  return idx > stageIdx("OPENING") && row.confirmStatus !== "CONFIRMED";
}
// M3：按异议处理态分文案——EXCEPTION（异议被退回，host 已处理终态）/DISPUTED（异议待 host 处理）不应显示"逾期未确认"
function overdueLabel(row: any) {
  if (row.confirmStatus === "EXCEPTION") return "异议已处理";
  if (row.confirmStatus === "DISPUTED") return "异议待处理";
  return "逾期未确认";
}

// ── Per-card stage progress (for submitted with known stage) ──
function cardProgress(row: any): number {
  if (row.status !== "submitted" || !row.project?.stage) return 0;
  const idx = stageIdx(row.project.stage);
  return idx < 0 ? 0 : Math.round(((idx + 1) / STAGES.length) * 100);
}
function cardStageLabel(row: any): string {
  return STAGES.find((s) => s.key === row.project?.stage)?.label || "-";
}

/** 投标进展 — 已提交投标记录 + 阶段时间线 + 撤回/开标确认入口 */
export default function MyBidsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState(false);
  const [submissions, setSubmissions] = useState<any[]>([]);

  const loadingRef = useRef(loading);
  const firstLoadRef = useRef(firstLoad);
  loadingRef.current = loading;
  firstLoadRef.current = firstLoad;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await supplierApi.listBidSubmissions();
      setSubmissions(list || []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setFirstLoad(false);
    }
  }, []);

  const retryLoad = useCallback(() => {
    setError(false);
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  // 实时兜底：回到页面（焦点/可见）自动重载——阶段流转（在线开标/专家评标/已归档）即时反映
  useEffect(() => {
    const onPageVisible = () => {
      if (document.visibilityState === "visible" && !loadingRef.current && !firstLoadRef.current) {
        load();
      }
    };
    window.addEventListener("focus", onPageVisible);
    document.addEventListener("visibilitychange", onPageVisible);
    return () => {
      window.removeEventListener("focus", onPageVisible);
      document.removeEventListener("visibilitychange", onPageVisible);
    };
  }, [load]);

  async function handleWithdraw(id: string) {
    if (!window.confirm("确定要撤回此标书吗？")) return;
    try {
      await supplierApi.withdrawSubmission(id);
      toast.success("投标已撤回");
      await load();
    } catch { /* API 层已全局错误 toast */ }
  }

  return (
    <div className="page-container">
      {/* ═══ Error ═══ */}
      {error && !loading ? (
        <div className="sp-error-block">
          <div className="sp-error-icon"><TriangleAlert size={22} strokeWidth={1.75} /></div>
          <div className="sp-error-text">数据加载失败</div>
          <div className="sp-error-desc">网络或服务异常，请稍后重试</div>
          <SpButton variant="primary" onClick={retryLoad}>重新加载</SpButton>
        </div>
      ) : loading && firstLoad ? (
        /* ═══ Skeleton ═══ */
        <>
          <div className="mb-skel-hero">
            <span className="sp-skel" style={{ width: 100, height: 13 }} />
            <span className="sp-skel" style={{ width: 200, height: 24, marginTop: 12 }} />
            <span className="sp-skel" style={{ width: 280, height: 14, marginTop: 10 }} />
          </div>
          <div className="mb-skel-list">
            {[1, 2, 3].map((i) => (
              <div key={i} className="mb-skel-row">
                <div style={{ flex: 1 }}><span className="sp-skel" style={{ width: "50%", height: 16 }} /><span className="sp-skel" style={{ width: "35%", height: 12, marginTop: 8 }} /></div>
                <span className="sp-skel" style={{ width: 80, height: 28 }} />
              </div>
            ))}
          </div>
        </>
      ) : (
        <div style={loading ? { opacity: 0.6, pointerEvents: "none", transition: "opacity .2s" } : undefined}>
          {/* ═══ HERO ═══ */}
          <SpPageHero
            icon={ClipboardList}
            title="投标进展"
            sub="跟踪已提交的投标记录与各项目所处阶段，及时关注开标进展。"
            actions={
              <SpButton variant="primary" icon={Plus} onClick={() => router.push("/bids")}>浏览投标机会</SpButton>
            }
          />

          {/* ═══ SUBMISSION LIST — neumorphic plates ═══ */}
          {submissions.length > 0 ? (
            <div className="mb-list">
              {submissions.map((row, idx) => {
                const hasStage = row.status === "submitted" && row.project?.stage;
                const curIdx = stageIdx(row.project?.stage ?? "");
                return (
                  <div
                    key={row.id}
                    className={`mb-card ${row.status} ${hasStage ? "has-stage" : ""}`}
                    style={{
                      ...(hasStage ? { "--c": stageColor(row.project.stage) } : {}),
                      animationDelay: idx * 60 + "ms",
                    } as React.CSSProperties}
                  >
                    {/* Left accent bar (color-coded by stage or status) */}
                    <div className="mb-card-accent" />

                    {/* Main content */}
                    <div className="mb-card-main">
                      {/* Header row */}
                      <div className="mb-card-head">
                        <div className="mb-card-project">
                          <h3 className="mb-card-name">{row.project?.name || "-"}</h3>
                          <span className="mb-card-code">{row.project?.projectCode || "-"}</span>
                        </div>
                        <div className="mb-card-status-row">
                          {row.status === "submitted" && row.project?.stage && (
                            <span className="mb-card-stage-badge" style={{ "--c": stageColor(row.project.stage) } as React.CSSProperties}>
                              <span className="mb-card-stage-dot" />
                              {cardStageLabel(row)}
                            </span>
                          )}
                          <span className={`sp-status ${statusMap[row.status]?.cls || "draft"}`}>
                            {statusMap[row.status]?.label || row.status}
                          </span>
                          {/* A-101：已递交行回执签署徽标（列表载荷自带 receiptSignature，详情页可补签） */}
                          {row.status === "submitted" && (
                            <span className={`b-tag ${row.receiptSignature ? "b-tag--success" : "b-tag--warning"}`}>
                              {row.receiptSignature ? "回执已签" : "回执未签"}
                            </span>
                          )}
                          <button type="button" className="mb-detail-btn" onClick={() => router.push(`/bids/${row.projectId}`)}>详情</button>
                        </div>
                      </div>

                      {/* Meta row */}
                      <div className="mb-card-meta">
                        {row.bidPrice ? (
                          <span className="mb-card-meta-item">
                            <span className="mb-card-meta-label">报价</span>
                            {formatBidPrice(row.bidPrice)}
                          </span>
                        ) : row.envelopeVersion === "dual-v2" ? (
                          // dual-v2：报价已密封进双层信封，服务端不回传明文（开标唱标时揭示）
                          <span className="mb-card-meta-item sealed">
                            <span className="mb-card-meta-label">报价</span>
                            已密封 · 开标时揭示
                          </span>
                        ) : null}
                        {row.deliveryPeriod && (
                          <span className="mb-card-meta-item">
                            <span className="mb-card-meta-label">工期</span>
                            {row.deliveryPeriod}
                          </span>
                        )}
                        {row.submittedAt && (
                          <span className="mb-card-meta-item">
                            <span className="mb-card-meta-label">提交</span>
                            {dayjs(row.submittedAt).format("MM-DD HH:mm")}
                          </span>
                        )}
                        {row.project?.openTime && (
                          <span className="mb-card-meta-item">
                            <span className="mb-card-meta-label">开标</span>
                            {dayjs(row.project.openTime).format("MM-DD HH:mm")}
                          </span>
                        )}
                        {row.project?.deadline && (
                          <span className="mb-card-meta-item">
                            <span className="mb-card-meta-label">截止</span>
                            {dayjs(row.project.deadline).format("MM-DD HH:mm")}
                          </span>
                        )}
                      </div>

                      {/* Stage progress track (only for submitted with known stage) */}
                      {row.status === "submitted" && row.project?.stage && (
                        <div className="mb-stage-track">
                          <div className="mb-stage-track-bg">
                            <div className="mb-stage-track-fill" style={{ width: cardProgress(row) + "%" }} />
                          </div>
                          <div className="mb-stage-nodes">
                            {STAGES.map((s, si) => (
                              <div key={s.key} className={`mb-stage-node ${si < curIdx ? "done" : ""} ${si === curIdx ? "current" : ""}`}>
                                <span
                                  className={`mb-stage-dot ${si <= curIdx ? "done" : ""}`}
                                  style={si <= curIdx ? { "--c": s.color } as React.CSSProperties : undefined}
                                />
                                <span
                                  className={`mb-stage-label ${si <= curIdx ? "active" : ""}`}
                                  style={si <= curIdx ? { "--c": s.color } as React.CSSProperties : undefined}
                                >
                                  {s.label}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Draft hint */}
                      {row.status === "draft" && (
                        <div className="mb-draft-hint">
                          <span className="mb-draft-dot" />
                          草稿未提交 — 前往 <Link href={`/bids/${row.projectId}/submit`}>提交页</Link> 完成投递
                        </div>
                      )}
                    </div>

                    {/* Right actions — cgzxui 原生按钮，统一居中 */}
                    <div className="mb-card-actions">
                      {row.project?.stage === "OPENING" && (
                        <button type="button" className="b-link-btn" onClick={() => router.push(`/my-bids/${row.projectId}/opening-hall`)}>
                          进入开标大厅
                        </button>
                      )}
                      {row.confirmStatus === "CONFIRMED" ? (
                        <button type="button" className="neu-btn-xs is-success" disabled>已确认</button>
                      ) : canConfirmOpening(row) ? (
                        <button type="button" className="neu-btn-xs is-success" onClick={() => router.push(`/my-bids/${row.projectId}/opening-confirm`)}>开标确认</button>
                      ) : overdueUnconfirmed(row) ? (
                        <span className="mb-overdue">{overdueLabel(row)}</span>
                      ) : null}
                      <button
                        type="button"
                        className="neu-btn-xs is-warning"
                        style={{ visibility: canWithdraw(row) ? "visible" : "hidden" }}
                        onClick={() => handleWithdraw(row.id)}
                      >
                        撤回
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* ═══ Empty state ═══ */
            <div className="neu-card mb-empty">
              <div className="sp-empty-icon"><ClipboardList size={22} strokeWidth={1.75} /></div>
              <p className="sp-empty-text">暂无投标记录</p>
              <p className="sp-empty-desc">浏览招标项目并提交您的标书</p>
              <SpButton variant="primary" onClick={() => router.push("/bids")} style={{ marginTop: 16 }}>浏览投标机会</SpButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
