"use client";

import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { FileSignature, Inbox, TriangleAlert, Upload } from "lucide-react";
import { contractApi, type SpContract } from "@/lib/api/contract";
import { submitSatisfaction } from "@/lib/performance-client";
import { uploadFile } from "@/lib/api/upload";
import { SpPageHero } from "@/components/sp-page-hero";
import { EmptyState, LoadingBlock, SpButton } from "@/components/ui";
import { toast } from "sonner";
import "@/styles/pages/objections.css";

/** C2/C3（GB/T 43711 7.5.4/7.6）：供应商侧——查看采购合同、登记履行节点证明材料。 */
const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  drafting: { label: "草拟中", cls: "st-open" },
  internal_review: { label: "采购人内审中", cls: "st-open" },
  signed: { label: "已签署", cls: "st-answered" },
  performing: { label: "履行中", cls: "st-answered" },
  accepted: { label: "已验收", cls: "st-closed" },
  terminated: { label: "已终止", cls: "st-complaint" },
};
const TYPE_LABEL: Record<string, string> = { delivery: "交付", payment: "付款", acceptance: "验收" };

export default function ContractsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [items, setItems] = useState<SpContract[]>([]);

  const fetchList = async () => {
    setItems(await contractApi.listMine());
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

  const uploadProof = async (c: SpContract, fid: string) => {
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const asset = await uploadFile(file, "contract_document");
        await contractApi.attachProof(c.id, fid, asset.id);
        toast.success("履约证明已上传");
        await fetchList();
      } catch (e) {
        toast.error((e as Error).message || "上传失败");
      }
    };
    input.click();
  };

  if (error && !loading) {
    return (
      <>
        <SpPageHero icon={FileSignature} title="我的合同" sub="采购合同签署与履约证明登记" />
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
      <SpPageHero icon={FileSignature} title="我的合同" sub="成交合同的签署状态、履行节点与验收情况（GB/T 43711 7.5.4/7.6）" />

      {loading ? (
        <LoadingBlock text="正在加载合同…" />
      ) : items.length === 0 ? (
        <EmptyState icon={Inbox} title="暂无合同" desc="成交后采购人将在此发布合同，请留意消息通知" />
      ) : (
        <div className="obj-list">
          {items.map(c => {
            const st = STATUS_LABEL[c.status] ?? { label: c.status, cls: "st-closed" };
            return (
              <div key={c.id} className="obj-card">
                <div className="obj-head">
                  <span className={`obj-status ${st.cls}`}>{st.label}</span>
                  <span className="obj-code">{c.contractCode}</span>
                  <span className="obj-phase">项目 {c.projectCode}</span>
                  <span className="obj-date">{c.signedAt ? `签署于 ${dayjs(c.signedAt).format("YYYY-MM-DD")}` : dayjs(c.createdAt).format("YYYY-MM-DD")}</span>
                </div>
                <div className="obj-title">
                  合同金额 {c.amount != null ? `¥${Number(c.amount).toLocaleString("zh-CN")}` : "待定"}
                  <span className="obj-code" style={{ marginLeft: 10 }}>{c.contractType === "order" ? "框架协议订单" : "标准合同"}</span>
                </div>

                {c.fulfillments.length > 0 && (
                  <div className="obj-answer">
                    <span className="obj-answer-label">履行台账（可上传履约证明）</span>
                    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                      {c.fulfillments.map(f => (
                        <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.78rem", flexWrap: "wrap" }}>
                          <span className={`obj-status ${f.status === "done" ? "st-answered" : f.status === "exception" ? "st-complaint" : "st-open"}`}>
                            {f.status === "done" ? "完成" : f.status === "exception" ? "异常" : "待办"}
                          </span>
                          <strong style={{ color: "var(--accent-strong, #064ea2)" }}>{TYPE_LABEL[f.type] ?? f.type}</strong>
                          <span>{f.title}</span>
                          {f.amount != null && <span className="tabular-nums">¥{Number(f.amount).toLocaleString("zh-CN")}</span>}
                          {f.dueDate && <span style={{ color: "var(--muted-foreground)" }}>期限 {dayjs(f.dueDate).format("YYYY-MM-DD")}</span>}
                          {f.proofAssetId ? (
                            <span style={{ color: "var(--success, #1e7e34)", fontSize: "0.7rem" }}>已上传证明</span>
                          ) : (
                            <SpButton onClick={() => uploadProof(c, f.id)}><Upload size={12} /> 上传证明</SpButton>
                          )}
                          {/* E1（9.2）：验收后满意度简表 */}
                          {c.status === "accepted" && f.type === "acceptance" && (
                            <SpButton onClick={async () => {
                              const score = Number(prompt("满意度评分（1-5 分）:", "5"));
                              if (!score || score < 1 || score > 5) return;
                              const comment = prompt("意见建议（选填）:") ?? "";
                              try {
                                await submitSatisfaction({ projectCode: c.projectCode, score, comment: comment || undefined });
                                toast.success("感谢反馈（GB/T 43711 9.2 交易和服务对象评价）");
                              } catch { /* 全局 toast 已提示 */ }
                            }}>满意度评价</SpButton>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
