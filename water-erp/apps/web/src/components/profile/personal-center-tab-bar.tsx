'use client';

import { History, KeyRound, Settings, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type TabKey = 'basic-info' | 'security' | 'activity-log' | 'preferences';

interface TabConfig {
  key: TabKey;
  label: string;
  icon: LucideIcon;
}

export const TABS: TabConfig[] = [
  { key: 'basic-info', label: '基本资料', icon: UserRound },
  { key: 'security', label: '账号安全', icon: KeyRound },
  { key: 'activity-log', label: '操作日志', icon: History },
  { key: 'preferences', label: '偏好设置', icon: Settings },
];

interface PersonalCenterTabBarProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}

export function PersonalCenterTabBar({ activeTab, onTabChange }: PersonalCenterTabBarProps) {
  return (
    <nav
      className="flex flex-wrap items-center gap-0.5 rounded-[18px] border px-1.5 py-1"
      role="tablist"
      style={{
        backgroundColor: 'rgba(96,139,239,0.08)',
        borderColor: 'rgba(96,139,239,0.25)',
      }}
    >
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.key;

        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onTabChange(tab.key)}
            className={[
              'relative flex items-center gap-2 rounded-[14px] px-4 py-2.5 text-[13px] font-semibold transition-all duration-200',
              isActive
                ? 'bg-white text-[color:var(--accent)] shadow-[0_2px_10px_rgba(37,99,235,0.12)]'
                : 'text-[color:var(--muted-foreground)] hover:bg-white/50 hover:text-[color:var(--foreground)]',
            ].join(' ')}
          >
            <Icon size={16} strokeWidth={1.7} />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
