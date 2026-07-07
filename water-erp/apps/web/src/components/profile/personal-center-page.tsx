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

export function PersonalCenterPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>('basic-info');
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

  // Loading state — matches workbench empty/loading pattern
  if (loadingUser) {
    return (
      <div className="wb-panel mt-0 flex min-h-[420px] flex-col items-center justify-center gap-4">
        <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl">
          <Loader2 size={24} strokeWidth={1.4} className="animate-spin text-[color:var(--accent)]" />
        </div>
        <div className="text-center">
          <div className="text-sm font-medium text-[color:var(--foreground)]">正在加载个人中心</div>
          <div className="mt-1 text-xs text-[color:var(--muted-foreground)]">请稍候...</div>
        </div>
      </div>
    );
  }

  // Error state
  if (!user) {
    return (
      <div className="wb-panel mt-0 flex min-h-[420px] flex-col items-center justify-center gap-4">
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
    );
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case 'basic-info': return <TabBasicInfo user={user} departments={departments} onUserUpdated={handleUserUpdated} />;
      case 'security': return <TabSecurity user={user} />;
      case 'activity-log': return <TabActivityLog />;
      case 'preferences': return <TabPreferences />;
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PersonalCenterTabBar activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="relative flex min-h-0 gap-4 items-start">
        {/* Left: fixed hero card — hidden on mobile */}
        <div className="hidden w-[280px] shrink-0 self-start xl:block">
          <PersonalCenterHero
            user={user}
            onEdit={() => setActiveTab('basic-info')}
            onChangePassword={() => setActiveTab('security')}
            onLogout={handleLogout}
            loggingOut={loggingOut}
          />
        </div>

        {/* Right: tab content */}
        <div className="min-w-0 flex-1">{renderTabContent()}</div>
      </div>
    </div>
  );
}
