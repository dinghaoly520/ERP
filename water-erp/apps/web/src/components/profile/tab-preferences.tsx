'use client';

import { Loader2, AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { THEME_OPTIONS, HOME_PAGE_OPTIONS, type UserSettings } from '@/lib/api/user-settings';
import { useUserSettings } from '@/lib/user-settings-context';

export function TabPreferences() {
  const { settings, loading, updateSettings } = useUserSettings();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="neu-card-static p-5">
        <div className="flex min-h-[200px] items-center justify-center gap-2 text-sm text-[color:var(--muted-foreground)]">
          <Loader2 size={16} className="animate-spin" />正在加载设置...
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="neu-card-static p-5">
        <div className="flex min-h-[200px] items-center justify-center text-sm text-[color:var(--muted-foreground)]">
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
    <div className="space-y-5">
      {/* Theme */}
      <div className="neu-card-static p-5">
        <h3 className="neu-section-heading">主题</h3>
        <div className="mt-4 flex gap-2">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value} type="button" disabled={saving}
              onClick={() => handleUpdate({ theme: option.value })}
              className={[
                'flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-all',
                settings.theme === option.value
                  ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--accent)] shadow-[0_2px_8px_rgba(69,99,158,0.08)]'
                  : 'border-white/50 bg-white/50 text-[color:var(--muted-foreground)] hover:bg-white/75',
              ].join(' ')}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Default home page */}
      <div className="neu-card-static p-5">
        <h3 className="neu-section-heading">默认首页</h3>
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

      {/* Compact mode */}
      <div className="neu-card-static p-5">
        <h3 className="neu-section-heading">显示偏好</h3>
        <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-white/50 bg-white/42 p-4">
          <div>
            <div className="text-sm font-medium text-[color:var(--foreground)]">紧凑模式</div>
            <div className="mt-0.5 text-xs text-[color:var(--muted-foreground)]">减少界面间距，显示更多内容</div>
          </div>
          <button
            type="button"
            onClick={() => handleUpdate({ compactMode: !settings.compactMode })}
            disabled={saving}
            className={[
              'relative h-6 w-11 rounded-full transition-all',
              settings.compactMode ? 'bg-[color:var(--accent)]' : 'bg-gray-200',
            ].join(' ')}
          >
            <span className={[
              'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
              settings.compactMode ? 'translate-x-5' : '',
            ].join(' ')}
            />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-[rgba(215,89,89,0.18)] bg-[rgba(255,241,241,0.76)] px-4 py-3 text-sm text-[color:var(--danger)]">
          <AlertTriangle size={14} strokeWidth={1.6} className="mt-0.5 shrink-0" />{error}
        </div>
      )}
    </div>
  );
}
