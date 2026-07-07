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
    <nav className="inline-flex gap-1 rounded-2xl border border-white/50 bg-white/55 p-1 backdrop-blur-md" role="tablist">
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
              'relative flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200',
              isActive
                ? 'bg-white text-[color:var(--accent)] shadow-[0_2px_8px_rgba(69,99,158,0.1)]'
                : 'text-[color:var(--muted-foreground)] hover:bg-white/60 hover:text-[color:var(--foreground)]',
            ].join(' ')}
          >
            <Icon size={16} strokeWidth={1.8} />
            {tab.label}
            {isActive && (
              <span className="absolute bottom-0 left-4 right-4 h-[2.5px] rounded-full bg-[color:var(--accent)]" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
