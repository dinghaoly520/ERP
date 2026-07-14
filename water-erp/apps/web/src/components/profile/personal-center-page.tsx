'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { startTransition, useEffect, useState } from 'react';
import { fetchCurrentUser, fetchDepartments, logout } from '@/lib/api/auth';
import type { AuthUser, DepartmentItem } from '@/lib/api/auth';
import { clearWorkspaceCache } from '@/components/work-arrangements/work-arrangements-page';
import { PersonalCenterHero } from './personal-center-hero';
import { PersonalCenterTabBar } from './personal-center-tab-bar';
import type { TabKey } from './personal-center-tab-bar';
import { TabBasicInfo } from './tab-basic-info';
import { TabSecurity } from './tab-security';
import { TabActivityLog } from './tab-activity-log';
import { TabPreferences } from './tab-preferences';
import { TabWorkOverview } from './tab-work-overview';
import { TabWorkPortrait } from './tab-work-portrait';

export function PersonalCenterPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>('work-overview');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [departments, setDepartments] = useState<DepartmentItem[]>([]);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [currentUser, depts] = await Promise.all([
          fetchCurrentUser(),
          fetchDepartments(),
        ]);
        setUser(currentUser);
        setDepartments(depts);
      } catch {
        setUser(null);
      } finally {
        setLoadingUser(false);
      }
    };
    void load();
  }, []);

  const handleUserUpdated = (updated: AuthUser) => {
    setUser((prev) => prev ? { ...prev, ...updated } : prev);
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      clearWorkspaceCache();
      startTransition(() => { router.replace('/login'); router.refresh(); });
    } finally {
      setLoggingOut(false);
    }
  };

  if (loadingUser) {
    return (
      <div className="flex flex-col gap-4">
        <PersonalCenterTabBar activeTab="work-overview" onTabChange={() => {}} />
        <div className="wb-panel flex flex-col items-center justify-center gap-4 py-20">
          <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl">
            <Loader2 size={24} strokeWidth={1.4} className="animate-spin text-[color:var(--accent)]" />
          </div>
          <div className="text-center">
            <div className="text-sm font-medium text-[color:var(--foreground)]">正在加载个人中心</div>
            <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">请稍候...</div>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col gap-4">
        <PersonalCenterTabBar activeTab="work-overview" onTabChange={() => {}} />
        <div className="wb-panel flex flex-col items-center justify-center gap-4 py-20">
          <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl">
            <AlertTriangle size={24} strokeWidth={1.4} className="text-[color:var(--danger)]" />
          </div>
          <div className="text-center">
            <div className="text-sm font-medium text-[color:var(--foreground)]">无法加载账号信息</div>
            <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">请检查网络连接后重试</div>
          </div>
          <button type="button" onClick={() => window.location.reload()} className="neu-btn-soft mt-1">
            重试
          </button>
        </div>
      </div>
    );
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case 'work-overview': return <TabWorkOverview />;
      case 'work-portrait': return <TabWorkPortrait />;
      case 'basic-info': return <TabBasicInfo user={user} departments={departments} onUserUpdated={handleUserUpdated} />;
      case 'security': return <TabSecurity user={user} />;
      case 'activity-log': return <TabActivityLog />;
      case 'preferences': return <TabPreferences />;
    }
  };

  return (
    <div className="flex flex-col gap-4 pb-8">
      {/* Tab 栏 — 全宽顶部 */}
      <PersonalCenterTabBar activeTab={activeTab} onTabChange={setActiveTab} />

      {/* 主内容区：左卡片 + 右内容 */}
      <div className="flex gap-4">
        {/* 左侧个人信息卡 */}
        <div className="hidden w-[240px] shrink-0 xl:block">
          <PersonalCenterHero
            user={user}
            onEdit={() => setActiveTab('basic-info')}
            onChangePassword={() => setActiveTab('security')}
            onLogout={handleLogout}
            loggingOut={loggingOut}
          />
        </div>

        {/* 右侧内容区 */}
        <div className="min-w-0 flex-1">
          {renderTabContent()}
        </div>
      </div>
    </div>
  );
}
