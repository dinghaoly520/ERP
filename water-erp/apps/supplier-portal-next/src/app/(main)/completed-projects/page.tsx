"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dayjs from "dayjs";
import { Archive, ChevronRight, TriangleAlert } from "lucide-react";
import { completedProjectsApi, type CompletedProjectRow } from "@/lib/api/supplier";
import { SpPageHero } from "@/components/sp-page-hero";
import { EmptyState, LoadingBlock, SpButton } from "@/components/ui";
import "@/styles/pages/bids.css";

const OUTCOME_META: Record<string, { label: string; cls: string }> = {
  AWARDED: { label: "中标", cls: "approved" },
  PARTICIPATED: { label: "已投递 · 未中标", cls: "submitted" },
  INVITED: { label: "受邀 · 未投递", cls: "draft" },
  ABORTED: { label: "项目流标", cls: "disabled" },
};

/** 已完成项目 — 合作历史（归档/流标项目全量信息入口，点击查看详情） */
export default function CompletedProjectsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [rows, setRows] = useState<CompletedProjectRow[]>([]);

  useEffect(() => {
    (async () => {
      try {
        setRows(await completedProjectsApi.list());
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function fmtAmount(v: unknown): string {
    if (v == null || v === "") return "—";
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return n >= 10000 ? `${(n / 10000).toFixed(2)} 万元` : `${n} 元`;
  }

  return (
    <div className="page-container">
      <SpPageHero
        icon={Archive}
        title="已完成项目"
        sub="合作过的采购项目档案：中标结果、投递报价与项目全量信息"
      />

      {loading ? (
        <LoadingBlock text="加载已完成项目…" />
      ) : error ? (
        <div className="sp-error-block">
          <div className="sp-error-icon"><TriangleAlert size={22} strokeWidth={1.75} /></div>
          <div className="sp-error-text">数据加载失败</div>
          <div className="sp-error-desc">网络或服务异常，请稍后重试</div>
          <SpButton variant="primary" onClick={() => location.reload()}>重新加载</SpButton>
        </div>
      ) : rows.length === 0 ? (
        <div className="sp-module">
          <EmptyState icon={Archive} title="暂无已完成项目" desc="合作项目完结（归档）后将在此记录" />
        </div>
      ) : (
        <div className="neu-table-card">
          <div className="completed-projects-table-wrap">
            <table className="sp-table completed-projects-table">
              <caption className="sr-only">已完成项目列表</caption>
              <thead>
                <tr>
                  <th>项目名称</th>
                  <th>项目编号</th>
                  <th>采购方式</th>
                  <th>我的结果</th>
                  <th>中标金额</th>
                  <th>我的报价</th>
                  <th>完结时间</th>
                  <th style={{ width: 110 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const meta = OUTCOME_META[r.outcome] || { label: r.outcome, cls: "draft" };
                  return (
                    <tr key={r.projectId}>
                      <td data-label="项目名称" className="font-semibold">{r.name}</td>
                      <td data-label="项目编号" className="font-mono text-xs">{r.projectCode}</td>
                      <td data-label="采购方式">{r.procurementMethod}</td>
                      <td data-label="我的结果"><span className={`sp-status ${meta.cls}`}>{meta.label}</span></td>
                      <td data-label="中标金额">{r.outcome === "AWARDED" ? fmtAmount(r.awardAmount) : "—"}</td>
                      <td data-label="我的报价">{r.myBidPrice ? fmtAmount(r.myBidPrice) : "—"}</td>
                      <td data-label="完结时间" className="text-xs">{r.completedAt ? dayjs(r.completedAt).format("YYYY-MM-DD") : "—"}</td>
                      <td data-label="操作" className="completed-project-action-cell">
                        <Link
                          href={`/bids/${encodeURIComponent(r.projectId)}`}
                          className="completed-project-link"
                          aria-label={`查看项目 ${r.name}详情`}
                        >
                          查看详情<ChevronRight size={12} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
