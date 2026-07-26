'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ShoppingCart, Package, AlertTriangle, TrendingDown, TrendingUp,
  Bell, CheckCircle, ArrowRight, Activity,
} from 'lucide-react';
import { fetchCurrentUser, type AuthUser } from '@/lib/api/auth';
import {
  getDashboardStats, getPriceRadar, getSearchInsights,
  listApplications, listAlerts,
  type CatalogDashboardStats, type PriceRadarData, type SearchInsights,
  type CatalogApplication, type AlertRecord,
} from '@/lib/api/catalog-admin';

/** 内部岗位才可见待审/预警面板（与后端 @Roles 对齐，避免 403 刷屏） */
const INTERNAL_ROLES = ['admin', 'leader', 'staff'] as const;

/**
 * 集中采购目录 · 健康度概览
 * 与「目录管理」(catalog/page.tsx) 差异化：本页只读总览（KPI/异常/缺口/待办），
 * 不提供写操作；写操作统一进「目录管理」。侧边栏两个入口由此各有独立内容。
 */
export default function CentralCatalogOverviewPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [stats, setStats] = useState<CatalogDashboardStats | null>(null);
  const [radar, setRadar] = useState<PriceRadarData | null>(null);
  const [insights, setInsights] = useState<SearchInsights | null>(null);
  const [pendingApps, setPendingApps] = useState<CatalogApplication[]>([]);
  const [openAlerts, setOpenAlerts] = useState<AlertRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCurrentUser().then(setUser).catch(() => setUser(null));
    // 全部 Promise.allSettled：任一接口失败（含非内部角色 403）不阻塞其余面板
    Promise.allSettled([
      getDashboardStats(),
      getPriceRadar(),
      getSearchInsights(),
      listApplications({ status: 'PENDING' }),
      listAlerts({ isResolved: 'false' }),
    ]).then(([s, r, i, a, al]) => {
      if (s.status === 'fulfilled') setStats(s.value);
      if (r.status === 'fulfilled') setRadar(r.value);
      if (i.status === 'fulfilled') setInsights(i.value);
      if (a.status === 'fulfilled') setPendingApps(a.value);
      if (al.status === 'fulfilled') setOpenAlerts(al.value);
      setLoading(false);
    });
  }, []);

  const canManage = !!user && (INTERNAL_ROLES as readonly string[]).includes(user.role);

  const kpis: [string, string | number | undefined, typeof Package, string?][] = [
    ['目录总数', stats?.total, Package],
    ['有效', stats?.active, CheckCircle],
    ['价格异常', stats?.priceSurge, TrendingDown],
    ['即将过期', stats?.expiring, Bell],
    ['缺口品类', stats?.categoryGapCount, AlertTriangle],
    ['健康度', stats?.healthScore != null ? `${stats.healthScore}分` : '—', Activity, '目录健康度综合评分'],
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><ShoppingCart size={17} /></div>
            <div>
              <div className="page-hero__title">集中采购目录</div>
              <div className="page-hero__sub">目录健康度总览 · 价格异常 · 目录缺口 · 待办事项；品类/价格/审批等写操作请进入「目录管理」</div>
            </div>
          </div>
          <div className="page-hero__right">
            <Link href="/mall-management/catalog" className="neu-btn-primary is-info">进入目录管理 <ArrowRight size={14} /></Link>
          </div>
        </div>
      </div>

      {/* KPI 行 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {kpis.map(([label, value, Icon, hint]) => (
          <div key={label} title={hint} className="kpi-card p-3 rounded-xl flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] flex items-center gap-1"><Icon size={11} />{label}</span>
            <span className="text-[1.4rem] font-black tabular-nums text-[var(--foreground)]">{value ?? '—'}</span>
          </div>
        ))}
      </div>

      {/* 四象限 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <OverviewPanel icon={AlertTriangle} iconClass="text-[var(--warning)]" title="价格异常偏高（超均值 +2σ）"
          link="/mall-management/catalog?tab=suppliers" linkLabel="比价雷达 →"
          empty="暂无价格异常项">
          {(radar?.outliers ?? []).slice(0, 6).map(o => (
            <div key={o.id} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-[var(--warning-soft)] text-sm">
              <span className="truncate"><strong>{o.name}</strong> <span className="text-xs text-[var(--muted-foreground)]">{o.supplier || '—'}</span></span>
              <span className="tabular-nums font-semibold text-[var(--warning)]">¥{(o.referencePrice ?? 0).toLocaleString()}</span>
            </div>
          ))}
        </OverviewPanel>

        <OverviewPanel icon={TrendingDown} iconClass="text-[var(--warning)]" title="目录缺口（搜索无结果）"
          empty="目录覆盖良好，暂无缺口">
          {(insights?.gapKeywords ?? []).length === 0 ? null : (
            <div className="flex flex-wrap gap-1.5">
              {insights!.gapKeywords.slice(0, 16).map(s => (
                <span key={s.keyword} className="text-xs px-2 py-1 rounded-lg bg-[var(--warning-soft)] text-[var(--warning)] font-medium">{s.keyword} <span className="tabular-nums opacity-70">×{s.count}</span></span>
              ))}
            </div>
          )}
        </OverviewPanel>

        {canManage && (
          <OverviewPanel icon={CheckCircle} iconClass="text-[var(--accent)]" title={`待审供货申请（${pendingApps.length}）`}
            link="/mall-management/catalog?tab=approval" linkLabel="去审批 →"
            empty="暂无待审申请">
            {pendingApps.slice(0, 6).map(a => (
              <div key={a.id} className="flex items-center justify-between text-sm gap-2">
                <span className="truncate">{a.type === 'NEW_ITEM' ? a.proposedName : a.catalogItem?.name || '(已删除目录)'}</span>
                <span className="text-xs text-[var(--muted-foreground)] whitespace-nowrap">{a.supplier?.name || '—'}</span>
              </div>
            ))}
          </OverviewPanel>
        )}

        {canManage && (
          <OverviewPanel icon={Bell} iconClass="text-[var(--warning)]" title={`未处理价格预警（${openAlerts.length}）`}
            link="/mall-management/catalog?tab=alerts" linkLabel="查看 →"
            empty="暂无未处理预警">
            {openAlerts.slice(0, 6).map(a => (
              <div key={a.id} className="text-sm">
                <span className="text-xs text-[var(--muted-foreground)] mr-2">{new Date(a.createdAt).toLocaleDateString('zh-CN')}</span>
                {a.message}
              </div>
            ))}
          </OverviewPanel>
        )}
      </div>

      {/* 热门搜索 */}
      {(insights?.topSearches?.length ?? 0) > 0 && (
        <div className="wb-panel">
          <div className="wb-panel-header"><h3 className="text-sm font-bold flex items-center gap-2"><TrendingUp size={15} className="text-[var(--accent)]" /> 热门搜索（近 30 天）</h3></div>
          <div className="wb-panel-body">
            <div className="flex flex-wrap gap-1.5">
              {insights!.topSearches.slice(0, 16).map(s => (
                <span key={s.keyword} className="text-xs px-2 py-1 rounded-lg bg-[var(--accent-tint)] text-[var(--accent)]">{s.keyword} <span className="tabular-nums opacity-70">×{s.count}</span></span>
              ))}
            </div>
          </div>
        </div>
      )}

      {!canManage && (
        <div className="px-3 py-2 rounded-xl bg-[var(--accent-tint)] text-xs text-[var(--muted-foreground)] flex items-center gap-2">
          <Package size={14} className="flex-shrink-0" /> 当前为只读概览，浏览完整目录请进入「目录管理」。
        </div>
      )}
    </div>
  );
}

/** 概览面板：图标+标题+右上链接+空状态+子内容 */
function OverviewPanel({ icon: Icon, iconClass, title, link, linkLabel, empty, children }: {
  icon: typeof Package;
  iconClass?: string;
  title: string;
  link?: string;
  linkLabel?: string;
  empty: string;
  children?: React.ReactNode;
}) {
  const items = children ? (Array.isArray(children) ? children : [children]) : [];
  return (
    <div className="wb-panel">
      <div className="wb-panel-header">
        <h3 className="text-sm font-bold flex items-center gap-2"><Icon size={15} className={iconClass} /> {title}</h3>
        {link && <Link href={link} className="text-xs text-[var(--accent)]">{linkLabel}</Link>}
      </div>
      <div className="wb-panel-body">
        {items.length === 0 ? <p className="text-sm text-[var(--muted-foreground)]">{empty}</p> : <div className="flex flex-col gap-1.5">{children}</div>}
      </div>
    </div>
  );
}
