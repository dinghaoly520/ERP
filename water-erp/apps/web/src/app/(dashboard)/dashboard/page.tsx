'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DashboardAiPanel, MetricCard, ModuleCard } from '@/components/workbench';
import type { DashboardContext } from '@/components/workbench';
import { api } from '@/lib/api';
import { getCatalogStats, type CatalogStats } from '@/lib/api/catalog-admin';
import { listCatalogApplications } from '@/lib/api/catalog';
import type { User } from '@/lib/types';
import { numberOrZero } from '@/lib/workbench';
import {
  Building2, ClipboardCheck, Megaphone, ShoppingCart, UsersRound,
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
  const [pendingPriceApps, setPendingPriceApps] = useState(0);
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
      listCatalogApplications({ status: 'PENDING' }).catch(() => []),
    ]).then(([ss, as, expertList, cs, apps]) => {
      setSupplierStats(ss);
      setAnnouncementStats(as);
      setExperts(Array.isArray(expertList) ? expertList : []);
      setCatalogStats(cs);
      setPendingPriceApps(Array.isArray(apps) ? apps.length : 0);
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
  const announcementTotal = numberOrZero(announcementStats?.total);
  const announcementPublished = numberOrZero(announcementStats?.published);
  const supplierTotal = numberOrZero(supplierStats?.total);
  const supplierApproved = numberOrZero(supplierStats?.approved);
  const expertTotal = experts.length;
  const expertAssignments = experts.reduce((sum, expert) => sum + (expert.bidExperts || []).length, 0);
  const mallCatalogTotal = numberOrZero(catalogStats?.total);
  const mallCatalogActive = numberOrZero(catalogStats?.active);
  const mallCatalogAlerts = numberOrZero(catalogStats?.review);

  const dashboardContext = useMemo((): DashboardContext => ({
    supplier: { total: supplierTotal, approved: supplierApproved, pending: pendingSuppliers, risk: supplierRisk },
    announcement: { total: announcementTotal, published: announcementPublished, draftLike: announcementDraftLike },
    expert: { total: expertTotal, active: expertActiveCount, unfinished: expertUnfinishedCount },
    catalog: { total: mallCatalogTotal, active: mallCatalogActive, alerts: mallCatalogAlerts },
    applications: { pending: pendingPriceApps },
  }), [supplierTotal, supplierApproved, pendingSuppliers, supplierRisk, announcementTotal, announcementPublished, announcementDraftLike, expertTotal, expertActiveCount, expertUnfinishedCount, mallCatalogTotal, mallCatalogActive, mallCatalogAlerts, pendingPriceApps]);

  return (
    <div className="min-h-full space-y-6">

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="信息发布" value={loading ? '—' : `${announcementPublished}/${announcementTotal}`} hint="已发布 / 信息总量" tone="blue" icon={<Megaphone size={18} strokeWidth={1.7} />} onClick={() => router.push('/notice')} />
        <MetricCard label="供应商资源" value={loading ? '—' : `${supplierApproved}/${supplierTotal}`} hint="已入库 / 供应商总数" tone="green" icon={<Building2 size={18} strokeWidth={1.7} />} onClick={() => router.push('/supplier/repository')} />
        <MetricCard label="专家资源" value={loading ? '—' : `${expertTotal}`} hint={`${expertAssignments} 条参与记录`} tone="purple" icon={<UsersRound size={18} strokeWidth={1.7} />} onClick={() => router.push('/expert/repository')} />
        <MetricCard label="商城目录" value={loading ? '—' : `${mallCatalogActive}/${mallCatalogTotal}`} hint="有效目录 / 目录总量" tone="cyan" icon={<ShoppingCart size={18} strokeWidth={1.7} />} onClick={() => router.push('/mall-management/catalog')} />
        <MetricCard label="供应商待审批" value={loading ? '—' : pendingSuppliers} hint="注册入库待审核" tone="orange" icon={<Building2 size={18} strokeWidth={1.7} />} onClick={() => router.push('/supplier/approval')} />
        <MetricCard label="价格待审批" value={loading ? '—' : pendingPriceApps} hint="商城供货申请待审核" tone="red" icon={<ClipboardCheck size={18} strokeWidth={1.7} />} onClick={() => router.push('/mall-management/approval')} />
      </section>

      <DashboardAiPanel context={dashboardContext} ready={!loading} />

      <section className="grid gap-4 lg:grid-cols-4">
        <ModuleCard title="信息发布中心" description="公告、公示、政策制度、草稿与发布记录" tone="blue" icon={<Megaphone size={22} />} actionLabel="进入发布中心" onClick={() => router.push('/notice')} stats={<span className="text-sm text-[#5a6d8a]">已发布 {announcementPublished} 条，待完善 {announcementDraftLike} 条</span>} />
        <ModuleCard title="供应商管理中心" description="供应商审核、供应商库、评价、变更和黑名单" tone="green" icon={<Building2 size={22} />} actionLabel="管理供应商" onClick={() => router.push('/supplier/repository')} stats={<span className="text-sm text-[#5a6d8a]">已入库 {supplierApproved} 家，待审 {pendingSuppliers} 家</span>} />
        <ModuleCard title="专家管理中心" description="专家库、抽取分配、回避关系、履职评价" tone="purple" icon={<UsersRound size={22} />} actionLabel="管理专家" onClick={() => router.push('/expert/repository')} stats={<span className="text-sm text-[#5a6d8a]">专家 {expertTotal} 名，参与记录 {expertAssignments} 条</span>} />
        <ModuleCard title="电子商城管理" description="采购目录、价格审批、价格录入与操作日志" tone="cyan" icon={<ShoppingCart size={22} />} actionLabel="进入商城后台" onClick={() => router.push('/mall-management/catalog')} stats={<span className="text-sm text-[#5a6d8a]">目录 {mallCatalogTotal} 条，有效 {mallCatalogActive} 条，异常 {mallCatalogAlerts} 条</span>} />
      </section>
    </div>
  );
}
