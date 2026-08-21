"use client";

import { useEffect, useState } from "react";
import dayjs from "dayjs";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  FilePenLine,
  Inbox,
  Info,
  MessageSquare,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { supplierApi } from "@/lib/api/supplier";
import { LoadingBlock, SpButton } from "@/components/ui";
import { SpPageHero } from "@/components/sp-page-hero";
import "@/styles/pages/profile.css";

/* 变更申请状态 → 徽标色 / 图标（与 ChangeRequest.vue 一致） */
const STATUS: Record<string, { label: string; color: string; icon: LucideIcon }> = {
  PENDING: { label: "已申请", color: "var(--warning)", icon: Clock },
  APPROVED: { label: "已同意", color: "var(--success)", icon: CheckCircle2 },
  REJECTED: { label: "已拒绝", color: "var(--danger)", icon: XCircle },
};

/** 距今时长（x 天 / x 小时 / 刚刚） */
function since(ts: string): string {
  const d = Math.ceil((Date.now() - new Date(ts).getTime()) / 86400000);
  if (d > 0) return `${d} 天`;
  const h = Math.ceil((Date.now() - new Date(ts).getTime()) / 3600000);
  return h > 0 ? `${h} 小时` : "刚刚";
}

/**
 * 资料变更申请记录（ChangeRequest.vue 移植）。
 *
 * 注：Vue 源中另有一套「申请资料变更」弹窗（dlg/qpn/cpn，openDialog 触发），
 * 但模板里没有任何入口调用 openDialog（路由仅指向本页记录列表）——属不可达死代码，
 * 变更申请的实际入口在 /profile 页「申请资料变更」按钮（已随 CompanyInfo 移植）。
 * 本页仅移植可达部分：加载态 / 错误重试 / 记录时间线 / 空态。
 */
export default function ChangeRecordsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [records, setRecords] = useState<any[]>([]);

  const fetchRecords = async () => {
    setRecords(await supplierApi.listChangeRecords());
  };

  useEffect(() => {
    (async () => {
      try { await fetchRecords(); } catch { setError(true); } finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = async () => {
    setError(false); setLoading(true);
    try { await fetchRecords(); } catch { setError(true); } finally { setLoading(false); }
  };

  if (error && !loading) {
    return (
      <div className="sp-error-block">
        <div className="sp-error-icon"><TriangleAlert size={22} strokeWidth={1.75} /></div>
        <div className="sp-error-text">数据加载失败</div>
        <div className="sp-error-desc">网络或服务异常，请稍后重试</div>
        <SpButton variant="primary" onClick={() => void retry()}>重新加载</SpButton>
      </div>
    );
  }

  if (loading) return <LoadingBlock />;

  return (
    <>
      <SpPageHero
        icon={FilePenLine}
        eyebrow="申请记录"
        title="资料变更"
        sub="查看企业资料变更申请的处理进度与历史记录。"
      />

      {/* ═══ 变更记录时间线 ═══ */}
      {records.length > 0 ? (
        <div className="cr-list">
          {records.map((r) => {
            const s = STATUS[r.status];
            const PillIcon = s?.icon || Info;
            return (
              <div
                key={r.id}
                className="cr-card"
                style={{ "--st": s?.color || "var(--muted-foreground)" } as React.CSSProperties}
              >
                <div className="cr-rail" />
                <div className="cr-body">
                  <div className="cr-top">
                    <span className="cr-badge">{r.fieldLabel}</span>
                    <span className="cr-pill">
                      <PillIcon size={13} />
                      {s?.label || r.status}
                    </span>
                  </div>
                  <div className="cr-diff">
                    <div className="cr-diff-o">
                      <span className="cr-diff-lbl">原值</span>
                      <span className="cr-diff-v">{r.oldValue || "—"}</span>
                    </div>
                    <div className="cr-diff-ar"><ArrowRight size={16} /></div>
                    <div className="cr-diff-n">
                      <span className="cr-diff-lbl">新值</span>
                      <span className="cr-diff-v">{r.newValue}</span>
                    </div>
                  </div>
                  {r.reason && (
                    <div className="cr-why">
                      <MessageSquare size={13} className="cr-why-icon" />
                      <span>{r.reason}</span>
                    </div>
                  )}
                  <div className="cr-foot">
                    <span className="cr-ft">{dayjs(r.createdAt).format("YYYY-MM-DD HH:mm")}</span>
                    {r.status === "PENDING" && (
                      <span className="cr-wait"><span className="cr-wdot" />等待 {since(r.createdAt)}</span>
                    )}
                    {r.reviewedAt && (
                      <span className="cr-rv">审核于 {dayjs(r.reviewedAt).format("MM-DD HH:mm")}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="cr-empty">
          <div className="sp-empty-icon"><Inbox size={22} strokeWidth={1.75} /></div>
          <div className="cr-empty-title">暂无申请记录</div>
          <div className="cr-empty-desc">请在企业信息页点击「申请资料变更」提交变更，申请提交后将在此显示处理进度</div>
        </div>
      )}
    </>
  );
}
