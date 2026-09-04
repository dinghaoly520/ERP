"use client";

import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { Layers, Inbox, TriangleAlert } from "lucide-react";
import { frameworkApi, type MyFaEntry } from "@/lib/api/framework";
import { SpPageHero } from "@/components/sp-page-hero";
import { EmptyState, LoadingBlock, SpButton } from "@/components/ui";
import "@/styles/pages/objections.css";

/** B4（GB/T 43711 附录 D）：供应商侧——查看我入围的框架协议（价格规则/有效期/二阶段规则）。 */
const VARIANT_LABEL: Record<string, string> = {
  supplier_only: "定商", supplier_price: "定商定价", supplier_price_qty: "定商定价定量",
};
const FA_STATUS_LABEL: Record<string, string> = {
  drafting: "草拟中", entry: "入围登记中", active: "生效中", expired: "已到期", terminated: "已终止",
};

/** quotaRule 为自由 Json（无固定 schema）：常见键中文渲染，未知键/嵌套结构兜底原文 */
const QUOTA_KEY_LABEL: Record<string, string> = {
  min: "数量下限", max: "数量上限", ratio: "占比上限", share: "份额上限", quantity: "数量", unit: "单位",
};
function formatQuotaRule(rule: unknown): string {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return JSON.stringify(rule);
  const parts = Object.entries(rule as Record<string, unknown>).map(([k, v]) => {
    const label = QUOTA_KEY_LABEL[k] ?? k;
    const value = v !== null && typeof v === "object" ? JSON.stringify(v) : String(v);
    return `${label}：${value}`;
  });
  return parts.length > 0 ? parts.join("；") : JSON.stringify(rule);
}

export default function FrameworksPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [items, setItems] = useState<MyFaEntry[]>([]);

  const fetchList = async () => {
    setItems(await frameworkApi.listMine());
  };

  useEffect(() => {
    (async () => {
      try { await fetchList(); } catch { setError(true); } finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = async () => {
    setError(false); setLoading(true);
    try { await fetchList(); } catch { setError(true); } finally { setLoading(false); }
  };

  if (error && !loading) {
    return (
      <>
        <SpPageHero icon={Layers} title="我的框架协议" sub="入围协议与二阶段成交规则" />
        <div className="sp-error-block">
          <div className="sp-error-icon"><TriangleAlert size={22} strokeWidth={1.75} /></div>
          <div className="sp-error-text">数据加载失败</div>
          <div className="sp-error-desc">网络或服务异常，请稍后重试</div>
          <SpButton onClick={retry}>重试</SpButton>
        </div>
      </>
    );
  }

  return (
    <>
      <SpPageHero icon={Layers} title="我的框架协议" sub="入围的框架协议及其价格规则、有效期与第二阶段成交规则（GB/T 43711 附录 D）" />

      {loading ? (
        <LoadingBlock text="正在加载框架协议…" />
      ) : items.length === 0 ? (
        <EmptyState icon={Inbox} title="暂无入围协议" desc="通过框架协议一阶段入围后将在此展示" />
      ) : (
        <div className="obj-list">
          {items.map(e => (
            <div key={e.entryId} className="obj-card">
              <div className="obj-head">
                <span className={`obj-status ${e.status === "exited" ? "st-complaint" : e.status === "supplemented" ? "st-open" : "st-answered"}`}>
                  {e.status === "exited" ? "已退出" : e.status === "supplemented" ? "增补入围" : "在册"}
                </span>
                <span className={`obj-status ${e.fa.status === "active" ? "st-answered" : "st-closed"}`}>
                  协议{FA_STATUS_LABEL[e.fa.status] ?? e.fa.status}
                </span>
                <span className="obj-code">{e.fa.faCode}</span>
                <span className="obj-date">有效期至 {dayjs(e.fa.validUntil).format("YYYY-MM-DD")}</span>
              </div>
              <div className="obj-title">
                {e.fa.title}
                <span className="obj-phase" style={{ marginLeft: 10 }}>{VARIANT_LABEL[e.fa.variant] ?? "其他"}</span>
                {e.shareRatio != null && <span className="obj-code" style={{ marginLeft: 10 }}>占比 {e.shareRatio}%</span>}
              </div>
              {e.fa.priceRule?.formula && <p className="obj-content">价格规则：{String(e.fa.priceRule.formula)}</p>}
              {e.fa.quotaRule && <p className="obj-content">数量/占比约定：{formatQuotaRule(e.fa.quotaRule)}</p>}
              {e.fa.secondStageRule && <p className="obj-content">第二阶段规则：{e.fa.secondStageRule}</p>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
