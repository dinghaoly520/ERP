'use client';

import { Loader2, AlertTriangle, Palette, LayoutDashboard, Monitor, Globe, Bell, Eye } from 'lucide-react';
import { useState } from 'react';
import { THEME_OPTIONS, HOME_PAGE_OPTIONS, type UserSettings } from '@/lib/api/user-settings';
import { useUserSettings } from '@/lib/user-settings-context';

export function TabPreferences() {
  const { settings, loading, updateSettings } = useUserSettings();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="wb-panel flex min-h-[320px] flex-1 items-center justify-center gap-2.5 text-sm text-[color:var(--muted-foreground)]">
          <Loader2 size={18} className="animate-spin" />正在加载设置...
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="wb-panel flex min-h-[320px] flex-1 items-center justify-center text-sm text-[color:var(--muted-foreground)]">
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
    <div className="flex flex-1 flex-col gap-5">
      {/* Section 1: Appearance */}
      <div className="wb-panel p-6">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
          <Eye size={12} strokeWidth={1.8} className="text-[color:var(--accent)]" />
          外观
        </h3>

        {/* Theme */}
        <div className="mt-5">
          <div className="flex items-center gap-2">
            <Palette size={14} strokeWidth={1.6} className="shrink-0 text-[color:var(--accent)]" />
            <span className="text-[13px] font-semibold text-[color:var(--foreground)]">主题颜色</span>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--muted-foreground)]">
            选择你偏好的界面配色方案，可在浅色、深色之间切换或跟随系统自动调整
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value} type="button" disabled={saving}
                onClick={() => handleUpdate({ theme: option.value })}
                className={[
                  'flex items-center justify-center gap-2 rounded-[14px] border px-4 py-3 text-[13px] font-semibold transition-all duration-200',
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

        <hr className="wb-section-rule" />

        {/* Compact mode */}
        <div>
          <div className="flex items-center gap-2">
            <LayoutDashboard size={14} strokeWidth={1.6} className="shrink-0 text-[color:var(--accent)]" />
            <span className="text-[13px] font-semibold text-[color:var(--foreground)]">紧凑模式</span>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--muted-foreground)]">
            减少页面元素之间的间距，在同一屏幕内显示更多内容
          </p>
          <div className="mt-3">
            <div className="flex items-center justify-between gap-4 rounded-xl border border-[rgba(96,139,239,0.12)] bg-[rgba(96,139,239,0.04)] p-4">
              <div>
                <div className="text-[13px] font-semibold text-[color:var(--foreground)]">
                  {settings.compactMode ? '已启用' : '已关闭'}
                </div>
                <div className="mt-0.5 text-[12px] text-[color:var(--muted-foreground)]">
                  {settings.compactMode ? '界面间距已压缩' : '使用标准界面间距'}
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
      </div>

      {/* Section 2: Navigation */}
      <div className="wb-panel p-6">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
          <Globe size={12} strokeWidth={1.8} className="text-[color:var(--accent)]" />
          导航
        </h3>

        <div className="mt-5">
          <div className="flex items-center gap-2">
            <LayoutDashboard size={14} strokeWidth={1.6} className="shrink-0 text-[color:var(--accent)]" />
            <span className="text-[13px] font-semibold text-[color:var(--foreground)]">默认首页</span>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--muted-foreground)]">
            每次登录系统后自动跳转到此页面，可随时通过侧边栏切换
          </p>
          <div className="mt-3">
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
      </div>

      {/* Section 3: Notifications */}
      <div className="wb-panel p-6">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
          <Bell size={12} strokeWidth={1.8} className="text-[color:var(--accent)]" />
          通知与提醒
        </h3>
        <div className="mt-5 space-y-4">
          {/* Browser notifications */}
          <div className="flex items-center justify-between gap-4 rounded-xl border border-[rgba(96,139,239,0.12)] bg-[rgba(96,139,239,0.04)] p-4">
            <div>
              <div className="text-[13px] font-semibold text-[color:var(--foreground)]">浏览器通知</div>
              <div className="mt-0.5 text-[12px] leading-relaxed text-[color:var(--muted-foreground)]">
                系统有新公告或通知时，通过浏览器推送提醒你
              </div>
            </div>
            <button
              type="button"
              disabled
              className={[
                'relative h-6 w-11 shrink-0 rounded-full transition-all opacity-40 cursor-not-allowed',
                'bg-gray-200',
              ].join(' ')}
            >
              <span className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm" />
            </button>
          </div>

          {/* In-app notification */}
          <div className="flex items-center justify-between gap-4 rounded-xl border border-[rgba(96,139,239,0.12)] bg-[rgba(96,139,239,0.04)] p-4">
            <div>
              <div className="text-[13px] font-semibold text-[color:var(--foreground)]">站内消息提醒</div>
              <div className="mt-0.5 text-[12px] leading-relaxed text-[color:var(--muted-foreground)]">
                顶部导航栏显示未读消息红点，点击可查看详情
              </div>
            </div>
            <span className="flex items-center gap-1.5 rounded-full bg-[rgba(92,181,150,0.12)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--success)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--success)]" />
              默认开启
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm"
          style={{ backgroundColor: 'rgba(255,241,241,0.76)', borderColor: 'rgba(215,89,89,0.18)', color: 'var(--danger)' }}
        >
          <AlertTriangle size={14} strokeWidth={1.6} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Footer note */}
      <p className="text-center text-[11px] text-[color:var(--muted-foreground)]/60">
        更多设置项将在后续版本中陆续开放
      </p>
    </div>
  );
}
