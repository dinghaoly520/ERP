'use client';

import { Loader2, AlertTriangle, Palette, LayoutDashboard, Monitor } from 'lucide-react';
import { useState } from 'react';
import { THEME_OPTIONS, HOME_PAGE_OPTIONS, type UserSettings } from '@/lib/api/user-settings';
import { useUserSettings } from '@/lib/user-settings-context';

export function TabPreferences() {
  const { settings, loading, updateSettings } = useUserSettings();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="wb-panel p-6">
        <div className="flex min-h-[280px] items-center justify-center gap-2.5 text-sm text-[color:var(--muted-foreground)]">
          <Loader2 size={18} className="animate-spin" />正在加载设置...
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="wb-panel p-6">
        <div className="flex min-h-[280px] items-center justify-center text-sm text-[color:var(--muted-foreground)]">
          无法加载设置
        </div>
      </div>
    );
  }

  const handleUpdate = async (updates: Partial<UserSettings>) => {
    setSaving(true);
    setError(null);
    try {
      await updateSettings(updates);
    } catch {
      setError('保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Theme — wb-panel */}
      <div className="wb-panel p-6">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
          <Palette size={12} strokeWidth={1.8} className="text-[color:var(--accent)]" />
          主题
        </h3>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value} type="button" disabled={saving}
              onClick={() => handleUpdate({ theme: option.value })}
              className={[
                'flex items-center justify-center gap-2 rounded-[14px] border px-4 py-3.5 text-[13px] font-semibold transition-all duration-200',
                settings.theme === option.value
                  ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--accent)] shadow-[0_2px_10px_rgba(37,99,235,0.1)]'
                  : 'border-[rgba(96,139,239,0.12)] bg-[rgba(96,139,239,0.04)] text-[color:var(--muted-foreground)] hover:border-[rgba(96,139,239,0.25)] hover:bg-[rgba(96,139,239,0.08)]',
              ].join(' ')}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Default home page — wb-panel */}
      <div className="wb-panel p-6">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
          <LayoutDashboard size={12} strokeWidth={1.8} className="text-[color:var(--accent)]" />
          默认首页
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--muted-foreground)]">
          登录后自动跳转到此页面
        </p>
        <div className="mt-4">
          <select
            value={settings.defaultHomePage}
            onChange={(e) => handleUpdate({ defaultHomePage: e.target.value as UserSettings['defaultHomePage'] })}
            disabled={saving}
            className="neu-select w-full max-w-xs"
          >
            {HOME_PAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Display preferences — wb-panel */}
      <div className="wb-panel p-6">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
          <Monitor size={12} strokeWidth={1.8} className="text-[color:var(--accent)]" />
          显示偏好
        </h3>
        <div className="mt-4">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-[rgba(96,139,239,0.12)] bg-[rgba(96,139,239,0.04)] p-4">
            <div>
              <div className="text-[13px] font-semibold text-[color:var(--foreground)]">紧凑模式</div>
              <div className="mt-1 text-[12px] leading-relaxed text-[color:var(--muted-foreground)]">
                减少界面间距，显示更多内容
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleUpdate({ compactMode: !settings.compactMode })}
              disabled={saving}
              className={[
                'relative h-6 w-11 shrink-0 rounded-full transition-all duration-200',
                settings.compactMode ? 'bg-[color:var(--accent)]' : 'bg-gray-200',
              ].join(' ')}
            >
              <span className={[
                'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200',
                settings.compactMode ? 'translate-x-5' : '',
              ].join(' ')}
              />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm"
          style={{
            backgroundColor: 'rgba(255,241,241,0.76)',
            borderColor: 'rgba(215,89,89,0.18)',
            color: 'var(--danger)',
          }}
        >
          <AlertTriangle size={14} strokeWidth={1.6} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}
