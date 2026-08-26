"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import { ArrowRight, Bell, Megaphone, Search, TriangleAlert, X } from "lucide-react";
import { announcementApi } from "@/lib/api/announcement";
import { SpPageHero } from "@/components/sp-page-hero";
import { EmptyState, LoadingBlock, SpButton, SpInput, SpPagination } from "@/components/ui";
import "@/styles/pages/announcements.css";

const typeOptions = [
  { label: "全部", value: "" },
  { label: "采购公告", value: "BID_NOTICE" },
  { label: "补遗公告", value: "ADDENDUM" },
  { label: "资格预审", value: "PREQUAL_NOTICE" },
  { label: "预成交公示", value: "PRE_WIN_NOTICE" },
  { label: "成交公告", value: "WIN_NOTICE" },
  { label: "合同公告", value: "CONTRACT_NOTICE" },
  { label: "履行结果", value: "PERFORMANCE_NOTICE" },
  { label: "政策法规", value: "POLICY" },
  { label: "平台通知", value: "PLATFORM" },
];
const typeTagMap: Record<string, { label: string; type: string }> = {
  BID_NOTICE: { label: "采购公告", type: "primary" },
  ADDENDUM: { label: "补遗公告", type: "warning" },
  PREQUAL_NOTICE: { label: "资格预审公告", type: "primary" },
  PRE_WIN_NOTICE: { label: "预成交公示", type: "success" },
  WIN_NOTICE: { label: "成交公告", type: "success" },
  CONTRACT_NOTICE: { label: "合同公告", type: "primary" },
  PERFORMANCE_NOTICE: { label: "履行结果公告", type: "success" },
  POLICY: { label: "政策法规", type: "warning" },
  PLATFORM: { label: "平台通知", type: "info" },
};

// NEW 标记：上次访问之后发布，或 48h 内发布（兜底首次访问 lastVisit=0 也能看到新公告）。
// 未来时间（脏数据）不标，避免"还没发生的公告"被误标 NEW。
const NEW_WINDOW_MS = 48 * 3600 * 1000;

export default function AnnouncementListPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [activeType, setActiveType] = useState("");
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [lastVisit, setLastVisit] = useState(0);

  const fetchData = useCallback(
    async (opts?: { type?: string; search?: string; page?: number }) => {
      const type = opts?.type ?? activeType;
      const s = opts?.search ?? search;
      const page = opts?.page ?? currentPage;
      setLoading(true);
      setError(false);
      try {
        const res: any = await announcementApi.publicList({
          type: type || undefined,
          search: s || undefined,
          page,
          pageSize: 10,
        });
        setItems(res?.items || []);
        setTotal(res?.total || 0);
        localStorage.setItem("supplier_announce_visit", String(Date.now()));
        setLastVisit(Date.now());
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [activeType, search, currentPage],
  );

  useEffect(() => {
    try {
      const v = localStorage.getItem("supplier_announce_visit");
      if (v) setLastVisit(parseInt(v, 10) || 0);
    } catch { /* ignore */ }
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function isNew(ts: string): boolean {
    if (!ts) return false;
    const t = new Date(ts).getTime();
    if (t > Date.now()) return false;
    return t > Date.now() - NEW_WINDOW_MS || (lastVisit > 0 && t > lastVisit);
  }

  function handleSearch() {
    setCurrentPage(1);
    fetchData({ page: 1 });
  }
  function handleTab(value: string) {
    setActiveType(value);
    setCurrentPage(1);
    fetchData({ type: value, page: 1 });
  }
  function handlePageChange(page: number) {
    setCurrentPage(page);
    fetchData({ page });
  }

  if (error) {
    return (
      <div className="sp-error-block">
        <div className="sp-error-icon"><TriangleAlert size={22} strokeWidth={1.75} /></div>
        <div className="sp-error-text">数据加载失败</div>
        <div className="sp-error-desc">网络或服务异常，请稍后重试</div>
        <SpButton variant="primary" onClick={() => fetchData()}>重新加载</SpButton>
      </div>
    );
  }

  return (
    <>
      <SpPageHero icon={Megaphone} title="公告公示" sub="集中查看采购公告、预成交公示、成交公告、政策法规和平台通知。" />

      <div className="neu-card ann-filter">
        <div className="neu-tab-bar ann-tabs">
          {typeOptions.map((t) => (
            <button
              key={t.value}
              type="button"
              className={`neu-tab${activeType === t.value ? " active" : ""}`}
              onClick={() => handleTab(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="search-box">
          <Search size={14} className="search-box__icon" />
          <SpInput
            value={search}
            placeholder="搜索公告标题"
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
          />
          {search && (
            <button
              type="button"
              className="ann-search-clear"
              aria-label="清空"
              onClick={() => { setSearch(""); setCurrentPage(1); fetchData({ search: "", page: 1 }); }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <LoadingBlock />
      ) : items.length > 0 ? (
        <div className="announcement-list">
          {items.map((a) => (
            <div key={a.id} className="announcement-row" onClick={() => router.push(`/announcements/${a.id}`)}>
              <div className="ann-row-left">
                <span className={`ann-tag ann-tag--sm ann-tag--${typeTagMap[a.type]?.type || "info"}`}>
                  {typeTagMap[a.type]?.label || a.type}
                </span>
                <div className="ann-row-body">
                  <span className="ann-row-title">{a.title}</span>
                  {a.summary ? <span className="ann-row-summary">{a.summary}</span> : null}
                </div>
              </div>
              <div className="ann-row-right">
                {a.isTop ? <span className="top-badge">置顶</span> : null}
                {isNew(a.publishDate || a.createdAt) ? <span className="new-badge">NEW</span> : null}
                <span className="ann-row-date">{dayjs(a.publishDate || a.createdAt).format("YYYY-MM-DD")}</span>
                <ArrowRight size={16} className="ann-arrow" strokeWidth={1.75} />
              </div>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "center", paddingTop: 16 }}>
            <SpPagination page={currentPage} pageSize={10} total={total} onChange={handlePageChange} />
          </div>
        </div>
      ) : (
        <EmptyState icon={Bell} title="暂无公告" desc="当前没有符合条件的公告信息" />
      )}
    </>
  );
}
