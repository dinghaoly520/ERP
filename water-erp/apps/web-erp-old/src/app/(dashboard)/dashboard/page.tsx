'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DashboardAiPanel, MetricCard } from '@/components/workbench';
import type { DashboardContext } from '@/components/workbench';
import { useTrend } from '@/lib/hooks/use-trend';
import { api } from '@/lib/api';
import { getCatalogStats, type CatalogStats } from '@/lib/api/catalog-admin';
import type { User } from '@/lib/types';
import { numberOrZero } from '@water-erp/shared';
import {
  Building2, Megaphone, ShoppingCart, UsersRound,
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
  }), [supplierTotal, supplierApproved, pendingSuppliers, supplierRisk, announcementTotal, announcementPublished, announcementDraftLike, expertTotal, expertActiveCount, expertUnfinishedCount, mallCatalogTotal, mallCatalogActive, mallCatalogAlerts]);

  const trendAnnouncement = useTrend('announcement-published', announcementPublished);
  const trendSupplier = useTrend('supplier-approved', supplierApproved);
  const trendExpert = useTrend('expert-total', expertTotal);
  const trendCatalog = useTrend('catalog-active', mallCatalogActive);

  return (
    <div className="min-h-full space-y-6">

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard shimmer label="信息发布" value={loading ? '—' : `${announcementPublished}/${announcementTotal}`} hint="已发布 / 信息总量" tone="blue" icon={<Megaphone size={18} strokeWidth={1.7} />} onClick={() => router.push('/notice')} trendDirection="up-good" trendDelta={trendAnnouncement?.delta ?? null} trendHistory={trendAnnouncement} />
        <MetricCard shimmer label="供应商资源" value={loading ? '—' : `${supplierApproved}/${supplierTotal}`} hint="已入库 / 供应商总数" tone="blue" icon={<Building2 size={18} strokeWidth={1.7} />} onClick={() => router.push('/supplier/repository')} trendDirection="up-good" trendDelta={trendSupplier?.delta ?? null} trendHistory={trendSupplier} />
        <MetricCard shimmer label="专家资源" value={loading ? '—' : `${expertTotal}`} hint={`${expertAssignments} 条参与记录`} tone="blue" icon={<UsersRound size={18} strokeWidth={1.7} />} onClick={() => router.push('/expert/repository')} trendDirection="neutral" trendHistory={trendExpert} />
        <MetricCard shimmer label="商城目录" value={loading ? '—' : `${mallCatalogActive}/${mallCatalogTotal}`} hint="有效目录 / 目录总量" tone="blue" icon={<ShoppingCart size={18} strokeWidth={1.7} />} onClick={() => router.push('/mall-management/catalog')} trendDirection="up-good" trendDelta={trendCatalog?.delta ?? null} trendHistory={trendCatalog} />
      </section>

      <DashboardAiPanel context={dashboardContext} ready={!loading} />
    </div>
  );
}
