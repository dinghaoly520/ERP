"use client";

import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { Layers, Inbox, TriangleAlert } from "lucide-react";
import { frameworkApi, type MyFaEntry } from "@/lib/api/framework";
import { SpPageHero } from "@/components/sp-page-hero";
import { EmptyState, LoadingBlock, SpButton, SpTabPanel, SpTabs } from "@/components/ui";
import { OwnArchivesPanel } from "@/components/own-archives-panel";
import { formatFrameworkQuotaRule } from "@/lib/framework-format";
import {
  getLocalRecordsPanelVisibility,
  type LocalRecordsView,
} from "@/lib/contract-forms";
import "@/styles/pages/objections.css";

/** B4（GB/T 43711 附录 D）：供应商侧——查看我入围的框架协议（价格规则/有效期/二阶段规则）。 */
const VARIANT_LABEL: Record<string, string> = {
  supplier_only: "定商", supplier_price: "定商定价", supplier_price_qty: "定商定价定量",
};
const FA_STATUS_LABEL: Record<string, string> = {
  drafting: "草拟中", entry: "入围登记中", active: "生效中", expired: "已到期", terminated: "已终止",
};

export default function FrameworksPage() {
  const [view, setView] = useState<LocalRecordsView>("platform");
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
  }, []);

  const retry = async () => {
    setError(false); setLoading(true);
    try { await fetchList(); } catch { setError(true); } finally { setLoading(false); }
  };
  const panels = getLocalRecordsPanelVisibility(view);

  return (
    <>
      <SpPageHero icon={Layers} title="框架协议" sub="查看平台入围协议，或管理企业自行留存的框架协议档案" />

      <div className="dense-workspace-tabs">
        <SpTabs
          value={view}
          onChange={setView}
          variant="line"
          semantics="tabs"
          ariaLabel="框架协议数据来源"
          tabs={[
            { value: "platform", label: "入围协议", tabId: "frameworks-platform-tab", panelId: "frameworks-platform-panel" },
            { value: "archive", label: "企业自存档案", tabId: "frameworks-archive-tab", panelId: "frameworks-archive-panel" },
          ]}
        />
      </div>

      <SpTabPanel
        id="frameworks-platform-panel"
        labelledBy="frameworks-platform-tab"
        active={panels.platform}
        className="dense-workspace-panel"
      >
          {error && !loading ? (
            <div className="sp-error-block" role="alert">
              <div className="sp-error-icon"><TriangleAlert size={22} strokeWidth={1.75} /></div>
              <div className="sp-error-text">数据加载失败</div>
              <div className="sp-error-desc">网络或服务异常，请稍后重试</div>
              <SpButton onClick={retry}>重试</SpButton>
            </div>
          ) : loading ? (
            <LoadingBlock text="正在加载框架协议…" />
          ) : items.length === 0 ? (
            <EmptyState card icon={Inbox} title="暂无入围协议" desc="通过框架协议一阶段入围后将在此展示" />
          ) : (
            <div className="obj-list">
              {items.map(e => {
                const quotaRule = formatFrameworkQuotaRule(e.fa.quotaRule);
                const formulaValue = e.fa.priceRule?.formula;
                const priceFormula = typeof formulaValue === "string"
                  ? formulaValue.trim()
                  : typeof formulaValue === "number" && Number.isFinite(formulaValue) ? String(formulaValue) : "";
                return (
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
                      <span className="obj-phase" style={{ marginLeft: 10 }}>{VARIANT_LABEL[e.fa.variant] ?? e.fa.variant}</span>
                      {e.shareRatio != null && <span className="obj-code" style={{ marginLeft: 10 }}>占比 {e.shareRatio}%</span>}
                    </div>
                    {priceFormula && <p className="obj-content">价格规则：{priceFormula}</p>}
                    {quotaRule && <p className="obj-content">数量/占比约定：{quotaRule}</p>}
                    {e.fa.secondStageRule && <p className="obj-content">第二阶段规则：{e.fa.secondStageRule}</p>}
                  </div>
                );
              })}
            </div>
          )}
      </SpTabPanel>

      <SpTabPanel
        id="frameworks-archive-panel"
        labelledBy="frameworks-archive-tab"
        active={panels.archive}
        className="dense-workspace-panel"
      >
        <OwnArchivesPanel category="framework" noun="框架协议" embedded />
      </SpTabPanel>
    </>
  );
}
