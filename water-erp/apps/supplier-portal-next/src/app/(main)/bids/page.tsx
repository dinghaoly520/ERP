"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import dayjs from "dayjs";
import { Gavel, ClipboardList, Search, X, ArrowRight, TriangleAlert } from "lucide-react";
import { bidApi } from "@/lib/api/bid";
import { SpPageHero } from "@/components/sp-page-hero";
import { SpButton, SpPagination, EmptyState } from "@/components/ui";
import { CountdownTimer } from "@/components/countdown-timer";
import "@/styles/pages/bids.css";

const stageMap: Record<string, { label: string; color: string }> = {
  DOWNLOAD: { label: "文件下载", color: "#0891b2" },
  SUBMIT: { label: "加密投递", color: "#c00a6b" },
  OPENING: { label: "在线开标", color: "#d97706" },
  EVALUATING: { label: "专家评标", color: "#7c3aed" },
  ARCHIVED: { label: "已归档", color: "#059669" },
};

function isSubmitStage(stage: string) {
  return stage === "SUBMIT";
}
/** DOWNLOAD 阶段截止临近（≤3 天）→ 粉色色轨 */
function isDeadlineClose(deadline: string): boolean {
  if (!deadline) return false;
  const diff = (new Date(deadline).getTime() - Date.now()) / 86400000;
  return diff > 0 && diff <= 3;
}
function rowClass(p: any) {
  if (p.stage === "SUBMIT") return "is-submit";
  if (p.stage === "DOWNLOAD" && isDeadlineClose(p.deadline)) return "is-dl-close";
  return "";
}

/** 获取窗口状态：未开始 / 进行中 / 已结束（直接采购项目仅公告发布后可见的门控由后端把关） */
function negoWindowState(p: any): "before" | "open" | "after" {
  const n = p.negotiation;
  if (!n) return "before";
  const now = Date.now();
  const s = new Date(n.acquireStartTime).getTime();
  const e = new Date(n.acquireEndTime).getTime();
  if (!isNaN(s) && now < s) return "before";
  if (!isNaN(e) && now > e) return "after";
  return "open";
}

/** 可投标项目列表 — 服务端真分页 + 服务端 search 过滤 */
export default function BidListPage() {
  const router = useRouter();
  const [firstLoad, setFirstLoad] = useState(true);
  const [search, setSearch] = useState("");
  const [filterScope] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [projects, setProjects] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [negoLoading, setNegoLoading] = useState<string>("");

  const pageRef = useRef(page);
  const searchRef = useRef(search);
  const loadingRef = useRef(loading);
  pageRef.current = page;
  searchRef.current = search;
  loadingRef.current = loading;

  const load = useCallback(
    async (p?: number, s?: string) => {
      const pg = p ?? pageRef.current;
      const se = s ?? searchRef.current;
      setLoading(true);
      setError(false);
      try {
        const res: any = await bidApi.listProjects({ page: pg, pageSize, search: se, scope: filterScope || undefined });
        const items = Array.isArray(res) ? res : res.items || [];
        setProjects(items);
        setTotal(res.total ?? items.length);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
        setFirstLoad(false);
      }
    },
    [pageSize, filterScope],
  );

  const retryLoad = useCallback(() => {
    load();
  }, [load]);

  // 搜索防抖（300ms），回到第 1 页（挂载首次触发跳过 — 对应 Vue watch 只在变更时触发）
  const searchMounted = useRef(false);
  useEffect(() => {
    if (!searchMounted.current) {
      searchMounted.current = true;
      return;
    }
    const timer = setTimeout(() => {
      setPage(1);
      pageRef.current = 1;
      load(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, load]);

  useEffect(() => {
    load();
  }, [load]);

  // 实时兜底：列表页无项目级 WS 房间，回到页面（焦点/可见）时自动重载——
  // 新公告开放投递（submission:opened）与阶段流转（在线开标/专家评标等）即时反映
  useEffect(() => {
    const onPageVisible = () => {
      if (document.visibilityState === "visible" && !loadingRef.current) load();
    };
    window.addEventListener("focus", onPageVisible);
    document.addEventListener("visibilitychange", onPageVisible);
    return () => {
      window.removeEventListener("focus", onPageVisible);
      document.removeEventListener("visibilitychange", onPageVisible);
    };
  }, [load]);

  function onPageChange(p: number) {
    setPage(p);
    pageRef.current = p;
    load(p);
  }

  // 谈判采购文件下载：校验获取窗口 + 权限由后端把关，前端拿到文件列表后逐个打开
  async function downloadNegotiationFiles(p: any) {
    setNegoLoading(p.id);
    try {
      const res: any = await bidApi.getNegotiationFiles(p.id);
      if (!res.files || res.files.length === 0) {
        toast.warning("该项目暂无可下载的采购文件");
        return;
      }
      if (res.downloadMode === "encrypted" && res.password) {
        toast.info(`加密文件，访问密码：${res.password}`);
      } else if (res.downloadMode === "paid" && res.paidAmount) {
        toast.info(`付费文件，金额：¥${res.paidAmount}`);
      }
      res.files.forEach((f: any) => window.open(f.url, "_blank", "noopener"));
    } catch {
      /* API 层已全局错误 toast */
    } finally {
      setNegoLoading("");
    }
  }

  return (
    <div className="page-container">
      {firstLoad && loading ? (
        <div className="skel-wrap">
          <div className="skel-hero"><span className="sp-skel" style={{ width: 120, height: 13 }} /><span className="sp-skel" style={{ width: 220, height: 24, marginTop: 12 }} /><span className="sp-skel" style={{ width: 320, height: 14, marginTop: 10 }} /></div>
          <div className="skel-filter"><span className="sp-skel" style={{ width: 300, height: 36 }} /><span className="sp-skel" style={{ flex: 1, height: 36 }} /></div>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skel-row"><div style={{ flex: 1 }}><span className="sp-skel" style={{ width: "60%", height: 18 }} /><span className="sp-skel" style={{ width: "40%", height: 12, marginTop: 10 }} /></div><span className="sp-skel" style={{ width: 120, height: 36 }} /></div>
          ))}
        </div>
      ) : error ? (
        <div className="sp-error-block">
          <div className="sp-error-icon"><TriangleAlert size={22} strokeWidth={1.75} /></div>
          <div className="sp-error-text">数据加载失败</div>
          <div className="sp-error-desc">网络或服务异常，请稍后重试</div>
          <SpButton variant="primary" onClick={retryLoad}>重新加载</SpButton>
        </div>
      ) : (
        <div style={loading ? { opacity: 0.6, pointerEvents: "none", transition: "opacity .2s" } : undefined}>
          <SpPageHero
            icon={Gavel}
            title="可投标项目"
            sub="按项目类别快速筛选与进入详情，持续关注最新招标公告。"
            actions={<span className="page-hero__stat page-hero__stat--info">共 {total} 个</span>}
          />

          <div className="bid-toolbar">
            <div className="bid-search">
              <span className="bs-icon"><Search size={14} strokeWidth={1.75} /></span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索项目名称或编号"
              />
              {search && (
                <button type="button" className="bs-clear" aria-label="清空" onClick={() => setSearch("")}>
                  <X size={13} strokeWidth={2} />
                </button>
              )}
            </div>
          </div>

          {projects.length > 0 ? (
            <div className="opportunity-list">
              {projects.map((p) => {
                const winState = negoWindowState(p);
                return (
                  <div key={p.id} className={`opportunity-row ${rowClass(p)}`} onClick={() => router.push(`/bids/${p.id}?from=list`)}>
                    <div className="row-main">
                      <div className="row-title-line">
                        <h3>{p.name}</h3>
                        <span className={`bid-tag ${p.stage === "SUBMIT" ? "bid-tag-submit" : ""}`}>
                          {p.accessScope === "INVITED" || p.accessScope === "DESIGNATED" ? "受邀" : "公告"}
                        </span>
                        <span
                          className="bid-stage"
                          style={{ "--stage-c": stageMap[p.stage]?.color || "#94a3b8" } as React.CSSProperties}
                        >
                          {stageMap[p.stage]?.label || p.stage}
                        </span>
                      </div>
                      <div className="row-meta">
                        <span className="meta-code">{p.projectCode}</span>
                        <span className="meta-sep">·</span>
                        <span>{p.procurementMethod}</span>
                        <span className="meta-sep">·</span>
                        <span>开标 {dayjs(p.openTime).format("MM-DD HH:mm")}</span>
                      </div>
                      {/* 谈判配置信息：采购文件获取窗口 + 开标时间 + 文件下载 */}
                      {p.negotiation && (
                        <div className="row-nego">
                          <span className="nego-item">
                            <span className="nego-label">采购文件获取</span>
                            <span className="nego-val">{dayjs(p.negotiation.acquireStartTime).format("MM-DD HH:mm")} ~ {dayjs(p.negotiation.acquireEndTime).format("MM-DD HH:mm")}</span>
                          </span>
                          <span className="nego-item">
                            <span className="nego-label">开标时间</span>
                            <span className="nego-val">{dayjs(p.negotiation.bidOpeningTime).format("YYYY-MM-DD HH:mm")}</span>
                          </span>
                          <button
                            type="button"
                            className={`neu-btn-xs nego-dl ${winState === "open" ? "is-open" : ""} ${winState === "before" ? "is-before" : ""}`}
                            disabled={winState !== "open" || negoLoading === p.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              downloadNegotiationFiles(p);
                            }}
                          >
                            {negoLoading === p.id
                              ? "下载中…"
                              : winState === "before"
                                ? `未开放（${p.negotiation.fileCount} 个文件）`
                                : winState === "after"
                                  ? "已截止"
                                  : `下载采购文件（${p.negotiation.fileCount}）`}
                          </button>
                        </div>
                      )}
                    </div>
                    <div className={`row-deadline ${isSubmitStage(p.stage) ? "submit-deadline" : ""}`}>
                      <small>投递截止</small>
                      <strong>{dayjs(p.deadline).format("MM-DD HH:mm")}</strong>
                      <CountdownTimer deadline={p.deadline} />
                    </div>
                    <button type="button" className="neu-btn-xs row-action">
                      详情<ArrowRight size={12} strokeWidth={1.75} style={{ marginLeft: 2 }} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            !loading && (
              <EmptyState
                icon={ClipboardList}
                title="暂无招标项目"
                desc={search || filterScope ? "没有符合当前筛选条件的项目，试试调整搜索或类别" : "当前没有符合条件的招标项目"}
              />
            )
          )}

          {total > pageSize && (
            <div className="pagination-wrap">
              <SpPagination page={page} pageSize={pageSize} total={total} onChange={onPageChange} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
