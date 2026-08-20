"use client";

/**
 * 我的供货申请 — 移植自 Vue supplier-portal/src/views/catalog/MyApplications.vue
 * 申请进度与议价。保留全部业务规则：
 *  - Tabs：进行中（PENDING/COUNTERED/RETURNED）/ 已结束（APPROVED/REJECTED/WITHDRAWN）
 *  - COUNTERED：可「接受议价」（acceptCounter，二次确认 ¥counterPrice）、「再报价」（edit 弹窗）、「撤回」
 *  - RETURNED：可「补正后重新提交」（edit 弹窗回填表单）、「撤回」
 *  - PENDING：仅可「撤回申请」；撤回（withdraw）二次确认
 *  - edit 模式重新提交走 updateApplication；COUNTERED 状态弹窗顶部显示管理员议价提示
 */
import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { toast } from "sonner";
import { AlertTriangle, FileSpreadsheet, Handshake, Inbox, Loader2 } from "lucide-react";
import { SpButton } from "@/components/ui";
import { SpPageHero } from "@/components/sp-page-hero";
import { catalogApi } from "@/lib/api/catalog";
import {
  ApplicationDialog,
  type CatalogApplication,
} from "@/components/catalog/application-dialog";
import "@/styles/pages/catalog.css";

const ACTIVE = ["PENDING", "COUNTERED", "RETURNED"];
const DONE = ["APPROVED", "REJECTED", "WITHDRAWN"];

const STATUS_META: Record<string, { label: string; type: string }> = {
  PENDING: { label: "待审核", type: "primary" },
  COUNTERED: { label: "议价中", type: "warning" },
  RETURNED: { label: "已退回", type: "danger" },
  APPROVED: { label: "已通过", type: "success" },
  REJECTED: { label: "已拒绝", type: "danger" },
  WITHDRAWN: { label: "已撤回", type: "info" },
};

const TYPE_LABEL: Record<string, string> = {
  NEW_ITEM: "新增品类", JOIN_EXISTING: "加入供货", UPDATE_QUOTE: "改报价",
};

function since(ts?: string): string {
  const t = ts ? new Date(ts).getTime() : Date.now();
  const d = Math.ceil((Date.now() - t) / 86400000);
  if (d > 0) return `已等待 ${d} 天`;
  const h = Math.ceil((Date.now() - t) / 3600000);
  return h > 0 ? `已等待 ${h} 小时` : "刚提交";
}

function itemTitle(a: CatalogApplication): string {
  return a.type === "NEW_ITEM" ? (a.proposedName || "未命名") : (a.catalogItem?.name || "-");
}
function itemSpec(a: CatalogApplication): string {
  if (a.type === "NEW_ITEM") {
    return [a.proposedSpec, a.proposedGroup, a.proposedCategory, a.proposedUnit].filter(Boolean).join(" · ");
  }
  return [a.catalogItem?.code, a.catalogItem?.specification, a.catalogItem?.unit].filter(Boolean).join(" · ");
}

export default function MyApplicationsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [applications, setApplications] = useState<CatalogApplication[]>([]);
  const [activeTab, setActiveTab] = useState<"active" | "done">("active");
  const [dialogVisible, setDialogVisible] = useState(false);
  const [editApp, setEditApp] = useState<CatalogApplication | null>(null);

  async function load() {
    setLoading(true); setError(false);
    try { setApplications(await catalogApi.listApplications() as CatalogApplication[]); }
    catch { setError(true); }
    finally { setLoading(false); }
  }
  function retryLoad() { load(); }

  const filtered = activeTab === "active"
    ? applications.filter((a) => ACTIVE.includes(a.status))
    : activeTab === "done"
      ? applications.filter((a) => DONE.includes(a.status))
      : applications;
  const counts = {
    active: applications.filter((a) => ACTIVE.includes(a.status)).length,
    done: applications.filter((a) => DONE.includes(a.status)).length,
  };

  async function withdraw(a: CatalogApplication) {
    if (!window.confirm("确认撤回？")) return;
    try {
      await catalogApi.withdraw(a.id);
      toast.success("已撤回");
      load();
    } catch { /* 全局拦截器已 toast */ }
  }

  async function acceptCounter(a: CatalogApplication) {
    if (!window.confirm(`接受议价 ¥${a.counterPrice}？`)) return;
    try {
      await catalogApi.acceptCounter(a.id);
      toast.success("已接受议价");
      load();
    } catch { /* 全局拦截器已 toast */ }
  }

  function edit(a: CatalogApplication) { setEditApp(a); setDialogVisible(true); }

  useEffect(() => { load(); }, []);

  return (
    <div className="page-container app-page-root">
      {error ? (
        <div className="sp-error-block">
          <div className="sp-error-icon"><AlertTriangle size={22} strokeWidth={1.75} /></div>
          <div className="sp-error-text">数据加载失败</div>
          <div className="sp-error-desc">网络或服务异常，请稍后重试</div>
          <SpButton variant="primary" onClick={retryLoad}>重新加载</SpButton>
        </div>
      ) : (
        <div className="cat-loading-host">
          {loading && (
            <div className="cat-loading-mask"><Loader2 size={22} strokeWidth={1.75} /></div>
          )}
          <SpPageHero icon={FileSpreadsheet} title="我的供货申请" sub="查看新增品类 / 加入供货 / 改报价申请的审核进度与议价记录。" />

          <div className="neu-tab-bar app-tabs">
            <button
              type="button"
              className={`neu-tab${activeTab === "active" ? " is-active" : ""}`}
              aria-pressed={activeTab === "active"}
              onClick={() => setActiveTab("active")}
            >
              进行中<span className="app-tab-count">{counts.active}</span>
            </button>
            <button
              type="button"
              className={`neu-tab${activeTab === "done" ? " is-active" : ""}`}
              aria-pressed={activeTab === "done"}
              onClick={() => setActiveTab("done")}
            >
              已结束<span className="app-tab-count">{counts.done}</span>
            </button>
          </div>

          {filtered.length === 0 && !loading ? (
            <div className="sp-empty app-empty">
              <div className="sp-empty-icon"><Inbox size={22} strokeWidth={1.75} /></div>
              <div className="sp-empty-text">暂无申请记录</div>
              <div className="sp-empty-desc">前往「集中采购目录」申请供货或新增品类</div>
            </div>
          ) : (
            <div className="app-list">
              {filtered.map((a) => {
                const meta = STATUS_META[a.status];
                return (
                  <div key={a.id} className="app-card">
                    <div className="app-card-head">
                      <span className={`app-type-tag ${a.type}`}>{TYPE_LABEL[a.type] ?? a.type}</span>
                      <div className="app-title-wrap">
                        <div className="app-title">{itemTitle(a)}</div>
                        <div className="app-spec">{itemSpec(a)}</div>
                      </div>
                      <span className={`cat-tag cat-tag--small cat-tag--${meta?.type || "info"}`}>
                        {meta?.label || a.status}
                      </span>
                    </div>
                    <div className="app-card-body">
                      <div className="app-info-grid">
                        <div className="app-info-item">
                          <span className="app-info-label">报价</span>
                          <span className="app-info-value price">
                            &yen;{a.quotedPrice}
                            {a.catalogItem?.unit || a.proposedUnit ? <small> / {a.catalogItem?.unit || a.proposedUnit}</small> : null}
                          </span>
                        </div>
                        {a.deliveryPeriod && (
                          <div className="app-info-item">
                            <span className="app-info-label">交货周期</span>
                            <span className="app-info-value">{a.deliveryPeriod}</span>
                          </div>
                        )}
                        {a.region && (
                          <div className="app-info-item">
                            <span className="app-info-label">区域</span>
                            <span className="app-info-value">{a.region}</span>
                          </div>
                        )}
                        {a.minOrder && (
                          <div className="app-info-item">
                            <span className="app-info-label">最小起订</span>
                            <span className="app-info-value">{a.minOrder}</span>
                          </div>
                        )}
                        <div className="app-info-item">
                          <span className="app-info-label">提交时间</span>
                          <span className="app-info-value">
                            {dayjs(a.createdAt).format("MM-DD HH:mm")}
                            {a.status === "PENDING" && <> · <span className="app-wait">{since(a.createdAt)}</span></>}
                          </span>
                        </div>
                      </div>
                      {a.status === "COUNTERED" && a.counterPrice && (
                        <div className="app-counter">
                          <Handshake size={18} strokeWidth={1.75} className="app-counter-icon" />
                          <div className="app-counter-body">
                            <div className="app-counter-title">管理员议价 <strong>&yen;{a.counterPrice}</strong></div>
                            {a.counterNote && <div className="app-counter-note">{a.counterNote}</div>}
                          </div>
                        </div>
                      )}
                      {(a.status === "RETURNED" || a.status === "REJECTED") && a.rejectReason && (
                        <div className="app-reason">
                          <AlertTriangle size={15} strokeWidth={1.75} />
                          <span>{a.status === "REJECTED" ? "拒绝理由" : "退回说明"}：{a.rejectReason}</span>
                        </div>
                      )}
                      {a.reviewerNote && (
                        <div className="app-note"><span className="app-note-label">审核备注</span>{a.reviewerNote}</div>
                      )}
                    </div>
                    <div className="app-card-foot">
                      {a.status === "COUNTERED" && (
                        <>
                          <SpButton variant="primary" onClick={() => acceptCounter(a)}>接受议价</SpButton>
                          <SpButton onClick={() => edit(a)}>再报价</SpButton>
                          <button type="button" className="app-btn-text" onClick={() => withdraw(a)}>撤回</button>
                        </>
                      )}
                      {a.status === "RETURNED" && (
                        <>
                          <SpButton variant="primary" onClick={() => edit(a)}>补正后重新提交</SpButton>
                          <button type="button" className="app-btn-text" onClick={() => withdraw(a)}>撤回</button>
                        </>
                      )}
                      {a.status === "PENDING" && (
                        <button type="button" className="app-btn-text" onClick={() => withdraw(a)}>撤回申请</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <ApplicationDialog
            open={dialogVisible} onClose={() => setDialogVisible(false)}
            mode="edit" application={editApp} onSuccess={load}
          />
        </div>
      )}
    </div>
  );
}
