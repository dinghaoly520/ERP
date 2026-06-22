'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useBidProjectContext } from '@/contexts/bid-project-context';
import ProjectHeader from './components/project-header';
import ProjectTabs, { TABS, getDefaultTab } from './components/project-tabs';
import { BidRealtimeProvider } from '@/contexts/bid-realtime-context';
import { Loader2 } from 'lucide-react';

// 动态导入子页面内容 — 复用现有组件
import BidOpenPage from '../../open/page';
import BidStandardPage from '../../standard/page';
import BidSupervisePage from '../../supervise/page';
import BidEvaluatePage from '../../evaluate/page';
import BidClarificationsPage from '../../clarifications/page';

function TabContent() {
  const searchParams = useSearchParams();
  const { project } = useBidProjectContext();
  const tab = searchParams.get('tab') || (project ? getDefaultTab(project.stage) : 'open');

  // 阶段门控：当前 tab 不在项目阶段允许范围内时，不渲染子页面
  // （ProjectTabs 已显示 stage-hint 引导消息）
  const tabDef = TABS.find(t => t.key === tab);
  if (tabDef && project && !tabDef.minStage.includes(project.stage)) {
    return null;
  }

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
    <BidRealtimeProvider>
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
    </BidRealtimeProvider>
  );
}
