"use client";

import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { BadgeCheck, Inbox, TriangleAlert, Send } from "lucide-react";
import { prequalApi, type PrequalListItem } from "@/lib/api/prequal";
import { SpPageHero } from "@/components/sp-page-hero";
import { EmptyState, LoadingBlock, SpButton } from "@/components/ui";
import { toast } from "sonner";
import "@/styles/pages/objections.css";

/** B3（GB/T 43711 7.2.3）：资格预审——查看进行中的预审并提交申请，结果双向告知（7.2.3.4）。 */
const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending: { label: "审查中", cls: "st-open" },
  passed: { label: "已合格", cls: "st-answered" },
  failed: { label: "未通过", cls: "st-complaint" },
};

export default function PrequalPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [items, setItems] = useState<PrequalListItem[]>([]);

  const fetchList = async () => {
    setItems(await prequalApi.list());
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

  const apply = async (p: PrequalListItem) => {
    const note = prompt("补充说明（选填，如主要业绩/资质）:") ?? "";
    if (note === "") return;
    try {
      await prequalApi.apply(p.id, note || undefined);
      toast.success("申请已提交");
      await fetchList();
    } catch { /* 全局 toast 已提示 */ }
  };

  if (error && !loading) {
    return (
      <>
        <SpPageHero icon={BadgeCheck} title="资格预审" sub="参与采购项目竞争的基本资格" />
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
      <SpPageHero icon={BadgeCheck} title="资格预审" sub="提交资格预审申请，审查结果将站内通知（GB/T 43711 7.2.3）" />

      {loading ? (
        <LoadingBlock text="正在加载预审…" />
      ) : items.length === 0 ? (
        <EmptyState icon={Inbox} title="暂无进行中的资格预审" desc="有新的预审公告时会在此展示，请留意消息通知" />
      ) : (
        <div className="obj-list">
          {items.map(p => {
            const st = p.myStatus ? STATUS_LABEL[p.myStatus] : null;
            return (
              <div key={p.id} className="obj-card">
                <div className="obj-head">
                  {st ? <span className={`obj-status ${st.cls}`}>{st.label}</span> : <span className="obj-status st-open">未申请</span>}
                  <span className="obj-phase">{p.mode === "centralized" ? "集中资格预审" : "单项资格预审"}</span>
                  <span className="obj-phase">{p.method === "limited" ? `有限数量制（取前 ${p.limitedCount ?? "—"} 名）` : "合格制"}</span>
                  <span className="obj-date">{dayjs(p.createdAt).format("YYYY-MM-DD")}</span>
                </div>
                <div className="obj-title">{p.title}</div>
                {p.validUntil && (
                  <p className="obj-content">合格有效期至：{dayjs(p.validUntil).format("YYYY-MM-DD")}（期内同品类免重复审查）</p>
                )}
                {!p.myStatus && (
                  <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
                    <SpButton variant="primary" onClick={() => apply(p)}><Send size={13} /> 提交申请</SpButton>
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
