'use client';

import { useEffect, useState } from 'react';
import { Building2, TrendingUp, Clock3, AlertTriangle, Activity, Star, ArrowLeft } from 'lucide-react';
import { getSupplierStats, getClassifications, getEvaluationStats, getQualificationAlerts, getRecentActivities, getFavorites } from '@/lib/api/supplier';
import type { SupplierStats, QualificationAlerts, ActivityItem, SupplierFavoriteRecord } from '@/lib/api/supplier';
import type { SupplierClassification } from '@/lib/types';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function SupplierDashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<SupplierStats | null>(null);
  const [classifications, setClassifications] = useState<SupplierClassification[]>([]);
  const [evalStats, setEvalStats] = useState<{ levelCounts: { A: number; B: number; C: number; D: number }; avgScore: number; total: number } | null>(null);
  const [alerts, setAlerts] = useState<QualificationAlerts | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [favorites, setFavorites] = useState<SupplierFavoriteRecord[]>([]);

  useEffect(() => {
    getSupplierStats().then(setStats).catch(() => {});
    getClassifications().then(setClassifications).catch(() => {});
    getEvaluationStats().then(setEvalStats).catch(() => {});
    getQualificationAlerts().then(setAlerts).catch(() => {});
    getRecentActivities().then(setActivities).catch(() => {});
    getFavorites().then(setFavorites).catch(() => {});
  }, []);

  const actionLabels: Record<string, string> = {
    SUPPLIER_APPROVED: '审核通过', SUPPLIER_REJECTED: '审核不通过', SUPPLIER_RETURNED: '退回补正',
    SUPPLIER_DISABLED: '停用', SUPPLIER_BLACKLIST: '拉黑', SUPPLIER_ELIMINATED: '淘汰',
  };

  const levelColors: Record<string, string> = { A: 'var(--success)', B: 'var(--accent)', C: 'var(--warning)', D: 'var(--danger)' };
  const maxCatCount = Math.max(1, ...classifications.map(c => c._count?.suppliers ?? 0));

  return (
    <div className="flex flex-col gap-5">
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><Building2 size={17} /></div>
            <div><div className="page-hero__title">供应商总览</div><div className="page-hero__sub">供应商资源池全景数据看板</div></div>
          </div>
          <div className="page-hero__right">
            <button onClick={() => router.push('/supplier/repository')} className="neu-btn-soft"><ArrowLeft size={15} />返回供应商库</button>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: '供应商总数', value: stats?.total ?? '—', icon: Building2, tone: 'var(--accent)' },
          { label: '已入库', value: stats?.approved ?? '—', icon: TrendingUp, tone: 'var(--success)' },
          { label: '待审核', value: stats?.pending ?? '—', icon: Clock3, tone: 'var(--warning)' },
          { label: '已停用/黑名单', value: (stats ? (stats.disabled ?? 0) + (stats.blacklist ?? 0) : '—'), icon: AlertTriangle, tone: 'var(--danger)' },
        ].map(kpi => (
          <div key={kpi.label} className="neu-table-card p-4 flex items-center gap-3">
            <div className="neu-icon-well flex h-9 w-9 items-center justify-center rounded-[10px]">
              <kpi.icon size={15} style={{ color: kpi.tone }} />
            </div>
            <div>
              <div className="text-xs text-[var(--muted-foreground)]">{kpi.label}</div>
              <div className="text-xl font-extrabold tabular-nums text-[var(--foreground)]">{kpi.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Classification distribution */}
        <div className="neu-table-card p-5">
          <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-4">分类分布</h3>
          {classifications.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)] py-8 text-center">暂无分类数据</p>
          ) : (
            <div className="space-y-3">
              {classifications.map(c => {
                const count = c._count?.suppliers ?? 0;
                const pct = maxCatCount > 0 ? (count / maxCatCount) * 100 : 0;
                return (
                  <div key={c.id} className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-[var(--foreground)] w-24 truncate">{c.name}</span>
                    <div className="flex-1 h-5 rounded-md bg-[var(--muted)]/30 overflow-hidden">
                      <div className="h-full rounded-md bg-[var(--accent)]/60 transition-all duration-700" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs tabular-nums text-[var(--muted-foreground)] w-10 text-right">{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Level distribution ring */}
        <div className="neu-table-card p-5">
          <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-4">评价等级分布</h3>
          {!evalStats || evalStats.total === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)] py-8 text-center">暂无评价数据</p>
          ) : (
            <div className="flex items-center gap-6">
              {(() => {
                const colors: Record<string, string> = { A: 'var(--success)', B: 'var(--accent)', C: 'var(--warning)', D: 'var(--danger)' };
                const total = evalStats.levelCounts.A + evalStats.levelCounts.B + evalStats.levelCounts.C + evalStats.levelCounts.D || 1;
                let acc = 0;
                const stops = (['A', 'B', 'C', 'D'] as const).map(l => {
                  const count = evalStats.levelCounts[l];
                  const start = (acc / total) * 360;
                  acc += count;
                  const end = (acc / total) * 360;
                  return count > 0 ? `${colors[l]} ${start.toFixed(1)}deg ${end.toFixed(1)}deg` : null;
                }).filter(Boolean).join(', ');
                return (
                  <div className="relative flex-shrink-0" style={{ width: 100, height: 100 }}>
                    <div className="w-full h-full rounded-full" style={{ background: `conic-gradient(${stops || 'var(--muted)'})` }} />
                    <div className="absolute inset-[16px] rounded-full bg-[var(--background)] flex items-center justify-center shadow-[inset_0_1px_3px_oklch(0.55_0.03_258/0.1)]">
                      <div className="text-center">
                        <div className="text-base font-black tabular-nums text-[var(--foreground)] leading-none">{evalStats.avgScore.toFixed(0)}</div>
                        <div className="text-[9px] text-[var(--muted-foreground)] mt-0.5">均分</div>
                      </div>
                    </div>
                  </div>
                );
              })()}
              <div className="space-y-2">
                {['A', 'B', 'C', 'D'].map(level => {
                  const count = evalStats.levelCounts[level as keyof typeof evalStats.levelCounts] || 0;
                  return (
                    <div key={level} className="flex items-center gap-2">
                      <span className="flex h-4 w-4 items-center justify-center rounded text-[9px] font-extrabold text-white" style={{ backgroundColor: levelColors[level] }}>{level}</span>
                      <span className="text-xs tabular-nums text-[var(--foreground)]">{count} 次</span>
                    </div>
                  );
                })}
                <div className="text-[11px] text-[var(--muted-foreground)] pt-1">均分 <strong className="text-[var(--foreground)]">{evalStats.avgScore.toFixed(1)}</strong></div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Qualification alerts summary */}
      {alerts && (alerts.expiredCount > 0 || alerts.expiringCount > 0) && (
        <div className="neu-table-card p-5">
          <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-3">资质到期提醒</h3>
          <div className="flex flex-wrap gap-3">
            <span className="rounded-lg bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] px-3 py-1.5 text-xs font-semibold text-[var(--danger)]">已过期 {alerts.expiredCount} 项</span>
            <span className="rounded-lg bg-[color-mix(in_oklch,var(--warning)_10%,transparent)] px-3 py-1.5 text-xs font-semibold text-[var(--warning)]">即将过期 {alerts.expiringCount} 项</span>
            <span className="text-xs text-[var(--muted-foreground)] self-center">影响 {alerts.affectedSupplierCount} 家供应商</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Recent activity */}
        <div className="neu-table-card p-5">
          <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-4 flex items-center gap-2"><Activity size={13} />近期动态</h3>
          {activities.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)] py-4 text-center">暂无动态</p>
          ) : (
            <div className="space-y-2 max-h-[360px] overflow-y-auto">
              {activities.map(a => (
                <div key={a.id} className="flex items-start gap-3 neu-card-static !rounded-xl !p-3">
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[10px] font-extrabold text-[var(--accent)]">
                    {actionLabels[a.action]?.[0] || a.action[0]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-[var(--foreground)] truncate">{actionLabels[a.action] || a.action}</div>
                    <div className="text-[10px] text-[var(--muted-foreground)]/70 mt-0.5">{a.actorName} · {new Date(a.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                    {a.details?.name && <div className="text-[11px] text-[var(--muted-foreground)] italic mt-0.5">{a.details.name}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Favorites */}
        <div className="neu-table-card p-5">
          <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-4 flex items-center gap-2"><Star size={13} />我的关注</h3>
          {favorites.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)] py-4 text-center">暂无关注供应商，在供应商库中点击 ⭐ 即可关注</p>
          ) : (
            <div className="space-y-2">
              {favorites.map(f => (
                <Link key={f.id} href={`/supplier/${f.supplierId}`} className="flex items-center gap-3 neu-card-static !rounded-xl !p-3 hover:ring-1 hover:ring-[var(--accent)]/20 transition">
                  <Star size={13} fill="var(--warning)" stroke="var(--warning)" className="flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-[var(--foreground)] truncate">{f.supplier.name}</div>
                    <div className="text-[10px] text-[var(--muted-foreground)]/70 mt-0.5">{f.supplier.enterpriseType} · {f.supplier.classification?.name || '未分类'}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
