'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useBidProjectContext } from '@/contexts/bid-project-context';
import ProjectHeader from './components/project-header';
import ProjectTabs from './components/project-tabs';
import { Loader2 } from 'lucide-react';

// 动态导入子页面内容 — 复用现有组件
import BidOpenPage from '../../open/page';
import BidStandardPage from '../../standard/page';
import BidSupervisePage from '../../supervise/page';
import BidEvaluatePage from '../../evaluate/page';
import BidClarificationsPage from '../../clarifications/page';

function TabContent() {
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') || 'open';

  // 注意：现有子页面组件内部调用了 useBidProjects() + ProjectSelector。
  // 在 Task 9 中会修改它们以读取 Context。当前先保持兼容，Tab 渲染可能显示
  // 旧版项目选择器。此处仅搭建外壳，子页面适配在 Task 9 完成。
  switch (tab) {
    case 'open': return <BidOpenPage />;
    case 'standard': return <BidStandardPage />;
    case 'supervise': return <BidSupervisePage />;
    case 'evaluate': return <BidEvaluatePage />;
    case 'clarify': return <BidClarificationsPage />;
    default: return <BidOpenPage />;
  }
}

export default function ProjectWorkspacePage() {
  const { isLoading } = useBidProjectContext();

  return (
    <div className="space-y-4">
      <ProjectHeader />

      <Suspense fallback={
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} strokeWidth={1.5} className="animate-spin text-[#8a96aa]" />
        </div>
      }>
        <ProjectTabs />
      </Suspense>

      {/* Tab 内容区 */}
      <Suspense fallback={
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} strokeWidth={1.5} className="animate-spin text-[#8a96aa]" />
        </div>
      }>
        <TabContent />
      </Suspense>
    </div>
  );
}
