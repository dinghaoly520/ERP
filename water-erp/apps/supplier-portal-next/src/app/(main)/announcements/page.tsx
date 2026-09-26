"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dayjs from "dayjs";
import {
  ArrowRight,
  Bell,
  FilePen,
  FileX,
  Inbox,
  ListChecks,
  Megaphone,
  Scale,
  Search,
  TriangleAlert,
  Trophy,
  X,
} from "lucide-react";
import { serverNowMs } from "@water-erp/shared";
import { announcementApi } from "@/lib/api/announcement";
import { SpPageHero } from "@/components/sp-page-hero";
import { EmptyState, LoadingBlock, SpButton, SpInput, SpPagination } from "@/components/ui";
import "@/styles/pages/announcements.css";
import "@/styles/pages/shared.css"; // 分段切换 .neu-segment（与「我的投标」状态切换同款）

const typeOptions: Array<{ label: string; value: string; icon: typeof Inbox }> = [
  { label: "全部", value: "", icon: Inbox },
  { label: "采购公告", value: "BID_NOTICE", icon: Megaphone },
  { label: "流标公告", value: "FAILED_BID_NOTICE", icon: FileX },
  { label: "中标公告", value: "WIN_BID_NOTICE,PRE_WIN_NOTICE", icon: Trophy },
  { label: "补遗公告", value: "ADDENDUM", icon: FilePen },
  { label: "资格预审", value: "PREQUAL_NOTICE", icon: ListChecks },
  { label: "政策法规", value: "POLICY", icon: Scale },
  { label: "平台通知", value: "PLATFORM", icon: Bell },
];
const typeTagMap: Record<string, { label: string; type: string }> = {
  BID_NOTICE: { label: "采购公告", type: "primary" },
  ADDENDUM: { label: "补遗公告", type: "warning" },
  PREQUAL_NOTICE: { label: "资格预审公告", type: "primary" },
  PRE_WIN_NOTICE: { label: "中标公告", type: "success" },
  WIN_NOTICE: { label: "成交公告", type: "success" },
  CONTRACT_NOTICE: { label: "合同公告", type: "primary" },
  PERFORMANCE_NOTICE: { label: "履行结果公告", type: "success" },
  POLICY: { label: "政策法规", type: "warning" },
  PLATFORM: { label: "平台通知", type: "info" },
  FAILED_BID_NOTICE: { label: "流标公告", type: "warning" },
  WIN_BID_NOTICE: { label: "中标公告", type: "success" },
};

// NEW 标记：上次访问之后发布，或 48h 内发布（兜底首次访问 lastVisit=0 也能看到新公告）。
// 未来时间（脏数据）不标，避免"还没发生的公告"被误标 NEW。
const NEW_WINDOW_MS = 48 * 3600 * 1000;

interface AnnouncementListItem {
  id: string;
  title: string;
  type: string;
  summary?: string | null;
  isTop?: boolean;
  publishDate?: string | null;
  createdAt: string;
  /** 已下线标题壳（2026-09-26 v2）：仅标题可见，不可点开看内容 */
  titleOnly?: boolean;
}

interface AnnouncementListResponse {
  items?: AnnouncementListItem[];
  total?: number;
}

function readLastVisit(): number {
  if (typeof window === "undefined") return 0;
  try {
    return Number.parseInt(window.localStorage.getItem("supplier_announce_visit") || "0", 10) || 0;
  } catch {
    return 0;
  }
}

export default function AnnouncementListPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [items, setItems] = useState<AnnouncementListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [activeType, setActiveType] = useState("");
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [lastVisit] = useState(readLastVisit);
  const [currentTime, setCurrentTime] = useState(0);

  const fetchData = useCallback(
    async (opts?: { type?: string; search?: string; page?: number }) => {
      const type = opts?.type ?? activeType;
      const s = opts?.search ?? search;
      const page = opts?.page ?? currentPage;
      setLoading(true);
      setError(false);
      try {
        const res = (await announcementApi.publicList({
          type: type || undefined,
          search: s || undefined,
          page,
          pageSize: 10,
        })) as AnnouncementListResponse;
        setItems(res?.items || []);
        setTotal(res?.total || 0);
        const seenAt = serverNowMs();
        setCurrentTime(seenAt);
        localStorage.setItem("supplier_announce_visit", String(seenAt));
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [activeType, search, currentPage],
  );

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function isNew(ts: string): boolean {
    if (!ts) return false;
    const t = new Date(ts).getTime();
    if (!Number.isFinite(t) || currentTime <= 0 || t > currentTime) return false;
    return t > currentTime - NEW_WINDOW_MS || (lastVisit > 0 && t > lastVisit);
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

      {/* ═══ 工具行：类型分段切换（左）+ 标题搜索（右，固定 280px）═══ */}
      <div className="ann-toolbar">
        <div className="mb-view-seg">
          <div
            className="neu-segment"
            role="group"
            aria-label="公告类型"
            data-count="8"
            data-index={String(typeOptions.findIndex((t) => t.value === activeType))}
          >
            <span className="neu-segment-thumb" aria-hidden="true" />
            {typeOptions.map((t) => (
              <button
                key={t.value}
                type="button"
                className="neu-segment-btn"
                aria-pressed={activeType === t.value}
                onClick={() => handleTab(t.value)}
              >
                <t.icon size={13} strokeWidth={1.9} aria-hidden="true" />{t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="search-box">
          <Search size={14} className="search-box__icon" />
          <SpInput
            className="neu-input-sm"
            value={search}
            placeholder="搜索公告标题"
            aria-label="搜索公告标题"
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
          {items.map((a) => a.titleOnly ? (
            /* 已下线标题壳（v2 2026-09-26）：只留标题，灰态不可点，内容不可查看 */
            <div key={a.id} className="announcement-row" aria-disabled="true" title="该公告已下线" style={{ cursor: 'default', opacity: 0.62 }}>
              <div className="ann-row-left">
                <span className={`ann-tag ann-tag--sm ann-tag--${typeTagMap[a.type]?.type || "info"}`}>
                  {typeTagMap[a.type]?.label || a.type}
                </span>
                <div className="ann-row-body">
                  <span className="ann-row-title">{a.title}</span>
                </div>
              </div>
              <div className="ann-row-right">
                <span className="top-badge" style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}>已下线</span>
                <span className="ann-row-date">{dayjs(a.publishDate || a.createdAt).format("YYYY-MM-DD")}</span>
              </div>
            </div>
          ) : (
            <Link
              key={a.id}
              href={`/announcements/${encodeURIComponent(a.id)}`}
              className="announcement-row"
              aria-label={`查看公告：${a.title}`}
            >
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
            </Link>
          ))}
          <div className="flex justify-center pt-4">
            <SpPagination page={currentPage} pageSize={10} total={total} onChange={handlePageChange} />
          </div>
        </div>
      ) : (
        <EmptyState card icon={Bell} title="暂无公告" desc="当前没有符合条件的公告信息" />
      )}
    </>
  );
}
