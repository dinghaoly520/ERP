'use client';

import { Loader2, AlertTriangle, Check, Palette, LayoutDashboard, Compass, Home } from 'lucide-react';
import { useState } from 'react';
import { THEME_OPTIONS, HOME_PAGE_OPTIONS, type UserSettings } from '@/lib/api/user-settings';
import { useUserSettings } from '@/lib/user-settings-context';

/** 设置行右列的枚举按钮组（≤4 项静态枚举；激活=品牌蓝实底白字） */
function OptionButtons<T extends string>({ value, options, onSelect, disabled }: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onSelect: (v: T) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {options.map(option => (
        <button key={option.value} type="button" disabled={disabled} onClick={() => onSelect(option.value)}
          className={[
            'rounded-[12px] px-3.5 py-1.5 text-[12px] font-semibold transition-all duration-200',
            value === option.value
              ? 'bg-[var(--accent)] text-white'
              : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
          ].join(' ')}
          style={value !== option.value ? { backgroundColor: 'oklch(0.55 0.03 258 / 0.05)' } : undefined}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

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
      {/* ══ 外观 ══ */}
      <div className="wb-panel p-6">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">
          <Palette size={12} strokeWidth={1.8} className="text-[var(--accent)]" />
          外观
        </h3>

        <div className="mt-2">
          {/* 主题颜色 */}
          <div className="flex items-start justify-between gap-6 py-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Palette size={14} strokeWidth={1.6} className="shrink-0 text-[var(--accent)]" />
                <span className="text-[13px] font-semibold text-[var(--foreground)]">主题颜色</span>
              </div>
              <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--muted-foreground)]">选择偏好的界面配色方案</p>
            </div>
            <OptionButtons
              value={settings.theme}
              options={THEME_OPTIONS}
              onSelect={(v) => void handleUpdate({ theme: v })}
              disabled={saving}
            />
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
            <button type="button" onClick={() => void handleUpdate({ compactMode: !settings.compactMode })} disabled={saving}
              className="relative h-6 w-11 shrink-0 rounded-full transition-all duration-200"
              style={{ backgroundColor: settings.compactMode ? 'var(--accent)' : 'oklch(0.55 0.03 258 / 0.2)' }}>
              <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-200 ${settings.compactMode ? 'translate-x-5' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* ══ 导航 ══ */}
      <div className="wb-panel p-6">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">
          <Compass size={12} strokeWidth={1.8} className="text-[var(--accent)]" />
          导航
        </h3>

        {/* 登录后落地页（2026-11-09 扩全候选 + 单选卡列表，用户裁定方案 A）：
            候选=工作台全部一级业务页（12 项），选中白瓷片凸起 + 对勾 */}
        <div className="mt-4 flex items-center gap-2">
          <Home size={14} strokeWidth={1.6} className="shrink-0 text-[var(--accent)]" />
          <span className="text-[13px] font-semibold text-[var(--foreground)]">登录后落地页</span>
          <span className="text-[12px] text-[var(--muted-foreground)]">下次登录生效</span>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {HOME_PAGE_OPTIONS.map(opt => {
            const active = settings.defaultHomePage === opt.value;
            const Icon = opt.icon;
            return (
              <button key={opt.value} type="button" disabled={saving}
                onClick={() => void handleUpdate({ defaultHomePage: opt.value })}
                className={`flex items-center gap-3 rounded-[14px] px-3.5 py-2.5 text-left transition-all duration-200 ${active ? '' : 'hover:bg-[color-mix(in_oklch,var(--foreground)_3%,transparent)]'}`}
                style={active ? { background: 'oklch(1 0 0 / 0.92)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 1px 1px 4px oklch(0.55 0.03 258 / 0.1), -1px -1px 3px oklch(1 0 0 / 0.85)' } : undefined}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]"
                  style={{ background: `color-mix(in oklch, var(--accent) ${active ? 12 : 7}%, transparent)`, color: 'var(--accent)' }}>
                  <Icon size={15} strokeWidth={1.8} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-bold text-[var(--foreground)]">{opt.label}</span>
                  <span className="block truncate text-[11px] text-[var(--muted-foreground)]">{opt.desc}</span>
                </span>
                {active && <Check size={14} strokeWidth={2.4} className="shrink-0 text-[var(--accent)]" />}
              </button>
            );
          })}
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
