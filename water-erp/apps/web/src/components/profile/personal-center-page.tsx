'use client';

import { Loader2 } from 'lucide-react';
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

  if (loadingUser) {
    return (
      <div className="flex min-h-[400px] items-center justify-center gap-3 text-sm text-[color:var(--muted-foreground)]">
        <Loader2 size={20} className="animate-spin" />正在加载个人中心...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 text-sm text-[color:var(--muted-foreground)]">
        <p>无法加载账号信息</p>
        <button type="button" onClick={() => window.location.reload()} className="neu-btn-soft">重试</button>
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
    <div className="space-y-5">
      <PersonalCenterTabBar activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="flex gap-5">
        <PersonalCenterHero
          user={user}
          onEdit={() => setActiveTab('basic-info')}
          onChangePassword={() => setActiveTab('security')}
          onLogout={handleLogout}
          loggingOut={loggingOut}
        />
        <div className="min-w-0 flex-1">{renderTabContent()}</div>
      </div>
    </div>
  );
}
