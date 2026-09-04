"use client";

import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { FileDown, FileSignature, Inbox, MessageSquareHeart, RefreshCcw, TriangleAlert, Upload } from "lucide-react";
import { contractApi, contractAssetUrl, type SpContract, type SpContractFulfillment } from "@/lib/api/contract";
import { SpPageHero } from "@/components/sp-page-hero";
import { EmptyState, LoadingBlock, SpButton, SpTabPanel, SpTabs } from "@/components/ui";
import { toast } from "sonner";
import { OwnArchivesPanel } from "@/components/own-archives-panel";
import { ProofUploadDialog } from "@/components/contracts/proof-upload-dialog";
import { SatisfactionDialog } from "@/components/contracts/satisfaction-dialog";
import {
  canAttachFulfillmentProof,
  getLocalRecordsPanelVisibility,
  type LocalRecordsView,
} from "@/lib/contract-forms";
import "@/styles/pages/objections.css";

/** C2/C3（GB/T 43711 7.5.4/7.6）：供应商侧——查看采购合同、登记履行节点证明材料。 */
const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  approved_for_signing: { label: "内审已通过·待签署", cls: "st-open" },
  signed: { label: "已签署", cls: "st-answered" },
  performing: { label: "履行中", cls: "st-answered" },
  accepted: { label: "已验收", cls: "st-closed" },
  terminated: { label: "已终止", cls: "st-complaint" },
};
const TYPE_LABEL: Record<string, string> = { delivery: "交付", payment: "付款", acceptance: "验收" };

export default function ContractsPage() {
  const [view, setView] = useState<LocalRecordsView>("platform");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [items, setItems] = useState<SpContract[]>([]);
  const [proofTarget, setProofTarget] = useState<{ contract: SpContract; fulfillment: SpContractFulfillment } | null>(null);
  const [satisfactionTarget, setSatisfactionTarget] = useState<SpContract | null>(null);

  const fetchList = async () => {
    setItems(await contractApi.listMine());
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
      <SpPageHero icon={FileSignature} title="合同履约" sub="查看平台合同履约进展，或管理企业自行留存的合同档案" />

      <div className="dense-workspace-tabs">
        <SpTabs
          value={view}
          onChange={setView}
          variant="line"
          semantics="tabs"
          ariaLabel="合同数据来源"
          tabs={[
            { value: "platform", label: "平台合同", tabId: "contracts-platform-tab", panelId: "contracts-platform-panel" },
            { value: "archive", label: "企业自存档案", tabId: "contracts-archive-tab", panelId: "contracts-archive-panel" },
          ]}
        />
      </div>

      <SpTabPanel
        id="contracts-platform-panel"
        labelledBy="contracts-platform-tab"
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
            <LoadingBlock text="正在加载合同…" />
          ) : items.length === 0 ? (
            <EmptyState card icon={Inbox} title="暂无合同" desc="成交后采购人将在此发布合同，请留意消息通知" />
          ) : (
            <div className="obj-list">
              {items.map(c => {
                const st = STATUS_LABEL[c.status] ?? { label: c.status, cls: "st-closed" };
                return (
                  <article key={c.id} className="obj-card">
                    <div className="obj-head">
                      <span className={`obj-status ${st.cls}`}>{st.label}</span>
                      <span className="obj-code">{c.contractCode}</span>
                      <span className="obj-phase">项目 {c.projectCode}</span>
                      <span className="obj-date">{c.signedAt ? `签署于 ${dayjs(c.signedAt).format("YYYY-MM-DD")}` : dayjs(c.createdAt).format("YYYY-MM-DD")}</span>
                    </div>
                    <div className="obj-title">
                      合同金额 {c.amount != null ? `¥${Number(c.amount).toLocaleString("zh-CN")}` : "待定"}
                      <span className="obj-code ml-2.5">{c.contractType === "order" ? "框架协议订单" : "标准合同"}</span>
                    </div>

                    {c.signedAssetId && (
                      <div className="mt-3 flex flex-wrap gap-2" aria-label={`${c.contractCode}合同文件`}>
                        {contractAssetUrl(c.signedAssetId) && (
                          <a className="neu-btn-soft inline-flex min-h-11 items-center gap-1.5" href={contractAssetUrl(c.signedAssetId)!} target="_blank" rel="noopener noreferrer">
                            <FileDown size={14} aria-hidden="true" />查看签署版合同
                          </a>
                        )}
                      </div>
                    )}

                    {c.fulfillments.length > 0 && (
                      <div className="obj-answer">
                        <span className="obj-answer-label">履行台账（可上传履约证明）</span>
                        <div className="mt-2 flex flex-col gap-2">
                          {c.fulfillments.map(f => (
                            <div key={f.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white/60 p-2.5 text-xs">
                              <span className={`obj-status ${f.status === "done" ? "st-answered" : f.status === "exception" ? "st-complaint" : "st-open"}`}>
                                {f.status === "done" ? "完成" : f.status === "exception" ? "异常" : "待办"}
                              </span>
                              <strong className="text-[var(--accent-strong)]">{TYPE_LABEL[f.type] ?? f.type}</strong>
                              <span>{f.title}</span>
                              {f.amount != null && <span className="tabular-nums">¥{Number(f.amount).toLocaleString("zh-CN")}</span>}
                              {f.dueDate && <span className="text-[var(--muted-foreground)]">期限 {dayjs(f.dueDate).format("YYYY-MM-DD")}</span>}
                              {f.proofAssetId ? (
                                <>
                                  <a className="neu-btn-link min-h-11" href={`/api/upload/files/${encodeURIComponent(f.proofAssetId)}`} target="_blank" rel="noopener noreferrer">查看证明</a>
                                  {canAttachFulfillmentProof(c.status, f.status) && (
                                    <SpButton icon={RefreshCcw} onClick={() => setProofTarget({ contract: c, fulfillment: f })}>替换证明</SpButton>
                                  )}
                                </>
                              ) : canAttachFulfillmentProof(c.status, f.status) ? (
                                <SpButton icon={Upload} onClick={() => setProofTarget({ contract: c, fulfillment: f })}>上传证明</SpButton>
                              ) : (
                                <span className="text-[var(--muted-foreground)]">该节点证据已锁定</span>
                              )}
                              {c.status === "accepted" && f.type === "acceptance" && (
                                <SpButton icon={MessageSquareHeart} onClick={() => setSatisfactionTarget(c)}>满意度评价</SpButton>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
      </SpTabPanel>

      <SpTabPanel
        id="contracts-archive-panel"
        labelledBy="contracts-archive-tab"
        active={panels.archive}
        className="dense-workspace-panel"
      >
        <OwnArchivesPanel category="contract" noun="合同" embedded />
      </SpTabPanel>

      <ProofUploadDialog
        open={Boolean(proofTarget)}
        contractId={proofTarget?.contract.id ?? null}
        contractCode={proofTarget?.contract.contractCode}
        fulfillment={proofTarget?.fulfillment ?? null}
        onClose={() => setProofTarget(null)}
        onComplete={async () => {
          toast.success("履约证明已上传并登记留痕");
          await fetchList();
        }}
      />
      <SatisfactionDialog
        open={Boolean(satisfactionTarget)}
        projectCode={satisfactionTarget?.projectCode ?? null}
        contractCode={satisfactionTarget?.contractCode}
        onClose={() => setSatisfactionTarget(null)}
        onComplete={() => toast.success("感谢反馈，评价已登记")}
      />
    </>
  );
}
