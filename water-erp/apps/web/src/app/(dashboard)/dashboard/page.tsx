'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DataToolbar, MetricCard, ModuleCard, PageHero, SectionCard, StatusBadge } from '@/components/workbench';
import { api } from '@/lib/api';
import { getCatalogStats, type CatalogStats } from '@/lib/api/catalog-admin';
import type { User } from '@/lib/types';
import { completionTone, formatDateTime, numberOrZero, percent, statusTone } from '@/lib/workbench';
import {
  Activity, AlertTriangle, ArrowRight, BellRing, Building2, CheckCircle2,
  Megaphone, PlusCircle, ShieldAlert, ShoppingCart, Sparkles, UsersRound,
} from 'lucide-react';

interface SupplierStats {
  total: number;
  pending: number;
  approved: number;
  disabled: number;
  blacklist: number;
}

interface AnnouncementStats {
  total: number;
  published: number;
  bidNotice: number;
  winNotice: number;
  policy: number;
}

interface ExpertAssignment {
  id: string;
  progress: number;
  signedIn: boolean;
  project?: { stage?: string };
}

interface ExpertItem {
  id: string;
  displayName: string;
  bidExperts?: ExpertAssignment[];
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [supplierStats, setSupplierStats] = useState<SupplierStats | null>(null);
  const [announcementStats, setAnnouncementStats] = useState<AnnouncementStats | null>(null);
  const [experts, setExperts] = useState<ExpertItem[]>([]);
  const [catalogStats, setCatalogStats] = useState<CatalogStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(setUser);

    Promise.all([
      api.get<SupplierStats>('/supplier/stats').catch(() => null),
      api.get<AnnouncementStats>('/announcements/stats').catch(() => null),
      api.get<ExpertItem[]>('/expert-admin').catch(() => []),
      getCatalogStats().catch(() => null),
    ]).then(([ss, as, expertList, cs]) => {
      setSupplierStats(ss);
      setAnnouncementStats(as);
      setExperts(Array.isArray(expertList) ? expertList : []);
      setCatalogStats(cs);
      setLoading(false);
    });
  }, []);

  const expertActiveCount = useMemo(() => experts.reduce((sum, expert) => {
    return sum + (expert.bidExperts || []).filter(item => item.project?.stage !== 'ARCHIVED').length;
  }, 0), [experts]);

  const expertUnfinishedCount = useMemo(() => experts.reduce((sum, expert) => {
    return sum + (expert.bidExperts || []).filter(item => numberOrZero(item.progress) < 100).length;
  }, 0), [experts]);

  const pendingSuppliers = numberOrZero(supplierStats?.pending);
  const announcementDraftLike = Math.max(numberOrZero(announcementStats?.total) - numberOrZero(announcementStats?.published), 0);
  const supplierRisk = numberOrZero(supplierStats?.disabled) + numberOrZero(supplierStats?.blacklist);
  const totalTodos = pendingSuppliers + announcementDraftLike + expertUnfinishedCount;
  const alertCount = supplierRisk + (expertUnfinishedCount > 0 ? 1 : 0);
  const announcementTotal = numberOrZero(announcementStats?.total);
  const announcementPublished = numberOrZero(announcementStats?.published);
  const supplierTotal = numberOrZero(supplierStats?.total);
  const supplierApproved = numberOrZero(supplierStats?.approved);
  const expertTotal = experts.length;
  const expertAssignments = experts.reduce((sum, expert) => sum + (expert.bidExperts || []).length, 0);
  const announcementHealth = percent(announcementPublished, announcementTotal);
  const supplierHealth = percent(supplierApproved, supplierTotal);
  const expertHealth = percent(Math.max(expertAssignments - expertUnfinishedCount, 0), expertAssignments);
  const mallCatalogTotal = numberOrZero(catalogStats?.total);
  const mallCatalogActive = numberOrZero(catalogStats?.active);
  const mallCatalogAlerts = numberOrZero(catalogStats?.review);

  return (
    <div className="min-h-full space-y-6">
      <PageHero
        eyebrow="采购运营总览"
        title={`欢迎回来，${user?.displayName || '采购管理员'}`}
        description="聚焦信息发布、供应商资源、专家履职和风险效率状态，用真实业务数据辅助日常管理判断。"
        icon={<Sparkles size={14} strokeWidth={1.8} />}
        actions={(
          <>
            <button onClick={() => router.push('/notice')} className="inline-flex items-center gap-2 rounded-xl bg-[#064ea2] px-4 py-2 text-sm font-bold text-white shadow-[0_10px_24px_rgba(6,78,162,0.20)] hover:bg-[#053f85]">
              <PlusCircle size={16} /> 新建信息
            </button>
            <button onClick={() => router.push('/supplier/approval')} className="inline-flex items-center gap-2 rounded-xl border border-[#dbeafe] bg-white px-4 py-2 text-sm font-bold text-[#064ea2] hover:bg-[#eff6ff]">
              处理审核 <ArrowRight size={16} />
            </button>
          </>
        )}
      >
        <DataToolbar className="bg-gradient-to-r from-[#f8fbff] to-[#ecfeff]">
          <StatusBadge tone="cyan">运行态势</StatusBadge>
          <span className="text-sm text-[#5a6d8a]">数据更新时间：{formatDateTime(new Date())}</span>
          <span className="text-sm text-[#5a6d8a]">当前聚合 {totalTodos} 项待处理、{alertCount} 项风险提醒</span>
        </DataToolbar>
      </PageHero>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="信息发布" value={loading ? '—' : `${announcementPublished}/${announcementTotal}`} hint="已发布 / 信息总量" tone="blue" icon={<Megaphone size={18} strokeWidth={1.7} />} onClick={() => router.push('/notice')} />
        <MetricCard label="供应商资源" value={loading ? '—' : `${supplierApproved}/${supplierTotal}`} hint="已入库 / 供应商总数" tone="green" icon={<Building2 size={18} strokeWidth={1.7} />} onClick={() => router.push('/supplier/repository')} />
        <MetricCard label="专家资源" value={loading ? '—' : `${expertTotal}`} hint={`${expertAssignments} 条参与记录`} tone="purple" icon={<UsersRound size={18} strokeWidth={1.7} />} onClick={() => router.push('/expert/repository')} />
        <MetricCard label="商城目录" value={loading ? '—' : `${mallCatalogActive}/${mallCatalogTotal}`} hint="有效目录 / 目录总量" tone="cyan" icon={<ShoppingCart size={18} strokeWidth={1.7} />} onClick={() => router.push('/mall-management/catalog')} />
        <MetricCard label="待处理事项" value={loading ? '—' : totalTodos} hint="待发布、待审核、专家未完成" tone="orange" icon={<BellRing size={18} strokeWidth={1.7} />} onClick={() => router.push('/supplier/approval')} />
        <MetricCard label="风险预警" value={loading ? '—' : alertCount} hint="异常供应商与专家提醒" tone="red" icon={<ShieldAlert size={18} strokeWidth={1.7} />} onClick={() => router.push('/dashboard#risk')} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
        <SectionCard title="业务运行健康度" description="以现有真实统计计算各业务中心当前运行状态" icon={<Activity size={20} strokeWidth={1.7} />}>
          <div className="space-y-5">
            {[
              { label: '信息发布健康度', value: announcementHealth, detail: `${announcementPublished} / ${announcementTotal} 已发布`, tone: completionTone(announcementHealth) },
              { label: '供应商库健康度', value: supplierHealth, detail: `${supplierApproved} / ${supplierTotal} 已入库`, tone: completionTone(supplierHealth) },
              { label: '专家履职健康度', value: expertHealth, detail: `${expertUnfinishedCount} 项未完成`, tone: completionTone(expertHealth) },
            ].map(item => (
              <div key={item.label}>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-bold text-[#18243a]">{item.label}</span>
                  <span className="text-[#5a6d8a]">{item.detail}</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-[#edf4fb]">
                  <div className={`h-full rounded-full bg-gradient-to-r ${statusTone[item.tone].gradient}`} style={{ width: `${item.value}%` }} />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard id="risk" title="风险与效率摘要" description="优先处理会影响采购运营连续性的事项" icon={<AlertTriangle size={20} strokeWidth={1.7} />}>
          <div className="space-y-3">
            <button onClick={() => router.push('/supplier/repository')} className="w-full rounded-xl border border-[#fecaca] bg-[#fef2f2] p-4 text-left text-sm text-[#991b1b] hover:bg-[#fee2e2]"><strong>异常/黑名单供应商：</strong>当前 {supplierRisk} 家供应商处于停用或黑名单状态。</button>
            <button onClick={() => router.push('/supplier/approval')} className="w-full rounded-xl border border-[#fed7aa] bg-[#fff7ed] p-4 text-left text-sm text-[#9a3412] hover:bg-[#ffedd5]"><strong>供应商待审：</strong>{pendingSuppliers} 家供应商等待资料审核。</button>
            <button onClick={() => router.push('/notice')} className="w-full rounded-xl border border-[#bfdbfe] bg-[#eff6ff] p-4 text-left text-sm text-[#064ea2] hover:bg-[#dbeafe]"><strong>信息发布效率：</strong>{announcementDraftLike} 条信息需要完善或发布。</button>
            <button onClick={() => router.push('/expert/repository')} className="w-full rounded-xl border border-[#ddd6fe] bg-[#f5f3ff] p-4 text-left text-sm text-[#5b21b6] hover:bg-[#ede9fe]"><strong>专家履职提醒：</strong>{expertUnfinishedCount} 项专家事项未完成。</button>
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-4 lg:grid-cols-4">
        <ModuleCard title="信息发布中心" description="公告、公示、政策制度、草稿与发布记录" tone="blue" icon={<Megaphone size={22} />} actionLabel="进入发布中心" onClick={() => router.push('/notice')} stats={<span className="text-sm text-[#5a6d8a]">已发布 {announcementPublished} 条，待完善 {announcementDraftLike} 条</span>} />
        <ModuleCard title="供应商管理中心" description="供应商审核、供应商库、评价、变更和黑名单" tone="green" icon={<Building2 size={22} />} actionLabel="管理供应商" onClick={() => router.push('/supplier/repository')} stats={<span className="text-sm text-[#5a6d8a]">已入库 {supplierApproved} 家，待审 {pendingSuppliers} 家</span>} />
        <ModuleCard title="专家管理中心" description="专家库、抽取分配、回避关系、履职评价" tone="purple" icon={<UsersRound size={22} />} actionLabel="管理专家" onClick={() => router.push('/expert/repository')} stats={<span className="text-sm text-[#5a6d8a]">专家 {expertTotal} 名，参与记录 {expertAssignments} 条</span>} />
        <ModuleCard title="电子商城管理" description="采购目录、价格审批、价格录入与操作日志" tone="cyan" icon={<ShoppingCart size={22} />} actionLabel="进入商城后台" onClick={() => router.push('/mall-management/catalog')} stats={<span className="text-sm text-[#5a6d8a]">目录 {mallCatalogTotal} 条，有效 {mallCatalogActive} 条，异常 {mallCatalogAlerts} 条</span>} />
      </section>

      <SectionCard title="运营摘要" description="按业务中心汇总当前可观察状态" icon={<CheckCircle2 size={20} strokeWidth={1.7} />}>
        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-xl bg-[#f8fbff] p-4"><span className="font-bold text-[#18243a]">发布动态</span><p className="mt-1 text-sm text-[#5a6d8a]">已发布 {announcementPublished} 条，招标公告 {numberOrZero(announcementStats?.bidNotice)} 条，中标公告 {numberOrZero(announcementStats?.winNotice)} 条。</p></div>
          <div className="rounded-xl bg-[#f8fbff] p-4"><span className="font-bold text-[#18243a]">供应商动态</span><p className="mt-1 text-sm text-[#5a6d8a]">总数 {supplierTotal} 家，已入库 {supplierApproved} 家，风险状态 {supplierRisk} 家。</p></div>
          <div className="rounded-xl bg-[#f8fbff] p-4"><span className="font-bold text-[#18243a]">专家动态</span><p className="mt-1 text-sm text-[#5a6d8a]">专家 {expertTotal} 名，当前 {expertActiveCount} 项参与记录，未完成 {expertUnfinishedCount} 项。</p></div>
          <div className="rounded-xl bg-[#f8fbff] p-4"><span className="font-bold text-[#18243a]">商城目录</span><p className="mt-1 text-sm text-[#5a6d8a]">目录 {mallCatalogTotal} 条，有效 {mallCatalogActive} 条，待处理 {mallCatalogAlerts} 条。</p></div>
        </div>
      </SectionCard>
    </div>
  );
}
