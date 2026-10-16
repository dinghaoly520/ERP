'use client';

import { Loader2, AlertTriangle, Check, Palette, LayoutDashboard } from 'lucide-react';
import { useState } from 'react';
import { THEME_OPTIONS, type UserSettings } from '@/lib/api/user-settings';
import { useUserSettings } from '@/lib/user-settings-context';

export function TabPreferences() {
  const { settings, loading, updateSettings } = useUserSettings();
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="wb-panel flex min-h-[320px] flex-1 items-center justify-center gap-2.5 text-sm text-[var(--muted-foreground)]">
        <Loader2 size={18} className="animate-spin" />正在加载设置...
      </div>
    );
  }
  if (!settings) {
    return (
      <div className="wb-panel flex min-h-[320px] flex-1 items-center justify-center text-sm text-[var(--muted-foreground)]">
        无法加载设置
      </div>
    );
  }

  const handleUpdate = async (updates: Partial<UserSettings>) => {
    setSaving(true); setError(null); setSuccess(null);
    try {
      await updateSettings(updates);
      setSuccess('保存成功');
      setTimeout(() => setSuccess(null), 2000);
    } catch { setError('保存失败，请稍后重试'); }
    finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ══ 外观与导航 ══ */}
      <div className="wb-panel p-6">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">
          <Palette size={12} strokeWidth={1.8} className="text-[var(--accent)]" />
          外观与导航
        </h3>

        <div className="mt-5 space-y-0">
          {/* 主题颜色 */}
          <div className="flex items-start justify-between gap-6 py-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Palette size={14} strokeWidth={1.6} className="shrink-0 text-[var(--accent)]" />
                <span className="text-[13px] font-semibold text-[var(--foreground)]">主题颜色</span>
              </div>
              <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--muted-foreground)]">选择偏好的界面配色方案</p>
            </div>
            <div className="flex gap-1.5">
              {THEME_OPTIONS.map(option => (
                <button key={option.value} type="button" disabled={saving} onClick={() => handleUpdate({ theme: option.value })}
                  className={[
                    'rounded-[12px] px-3.5 py-1.5 text-[12px] font-semibold transition-all duration-200',
                    settings.theme === option.value
                      ? 'bg-[var(--accent)] text-white'
                      : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
                  ].join(' ')}
                  style={settings.theme !== option.value ? { backgroundColor: 'oklch(0.55 0.03 258 / 0.05)' } : undefined}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <hr className="wb-section-rule" />

          {/* 紧凑模式 */}
          <div className="flex items-center justify-between gap-6 py-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <LayoutDashboard size={14} strokeWidth={1.6} className="shrink-0 text-[var(--accent)]" />
                <span className="text-[13px] font-semibold text-[var(--foreground)]">紧凑模式</span>
              </div>
              <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--muted-foreground)]">减少页面间距，同一屏幕显示更多内容</p>
            </div>
            <button type="button" onClick={() => handleUpdate({ compactMode: !settings.compactMode })} disabled={saving}
              className="relative h-6 w-11 shrink-0 rounded-full transition-all duration-200"
              style={{ backgroundColor: settings.compactMode ? 'var(--accent)' : 'oklch(0.55 0.03 258 / 0.2)' }}>
              <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-200 ${settings.compactMode ? 'translate-x-5' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* 提示条 */}
      {success && (
        <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm"
          style={{ backgroundColor: 'oklch(0.7 0.15 155 / 0.08)', color: 'var(--success)' }}>
          <Check size={14} strokeWidth={1.6} className="mt-0.5 shrink-0" />{success}
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm"
          style={{ backgroundColor: 'oklch(0.6 0.18 25 / 0.06)', color: 'var(--danger)' }}>
          <AlertTriangle size={14} strokeWidth={1.6} className="mt-0.5 shrink-0" />{error}
        </div>
      )}
    </div>
  );
}
