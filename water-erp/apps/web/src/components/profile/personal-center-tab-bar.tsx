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
    <nav className="neu-tab-bar" role="tablist">
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
            className={['neu-tab', isActive ? 'is-active' : ''].join(' ')}
          >
            <Icon size={16} strokeWidth={1.7} />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
