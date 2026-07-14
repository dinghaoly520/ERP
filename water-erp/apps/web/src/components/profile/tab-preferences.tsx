'use client';

import { Loader2, AlertTriangle, Palette, LayoutDashboard, Globe, Bell, UserCheck, Tag, AlertTriangle as AlertIcon, Clock, FileText } from 'lucide-react';
import { useState } from 'react';
import { THEME_OPTIONS, HOME_PAGE_OPTIONS, type UserSettings } from '@/lib/api/user-settings';
import { useUserSettings } from '@/lib/user-settings-context';

type NotifToggle = { type: string; label: string; desc: string; icon: typeof Bell };

const NOTIF_TOGGLES: { group: string; items: NotifToggle[] }[] = [
  {
    group: '审批与审核',
    items: [
      { type: 'SUPPLIER_PENDING', label: '供应商审批', desc: '新供应商入库、变更申请等', icon: UserCheck },
      { type: 'PRICE_REVIEW', label: '价格复核', desc: '报价调整、目录新增待审批', icon: Tag },
    ],
  },
  {
    group: '预警与到期',
    items: [
      { type: 'QUALIFICATION_EXPIRING', label: '资质到期', desc: '供应商资质证书即将到期提醒', icon: AlertIcon },
      { type: 'BID_REMINDER', label: '投标截止', desc: '投标即将截止的提醒通知', icon: Clock },
    ],
  },
  {
    group: '招投标与公告',
    items: [
      { type: 'BID_PUBLISHED', label: '招标公告', desc: '新招标项目发布通知', icon: FileText },
      { type: 'BID_OPENING', label: '开标通知', desc: '开标时间确认与提醒', icon: Bell },
    ],
  },
];

export function TabPreferences() {
  const { settings, loading, updateSettings } = useUserSettings();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <div className="wb-panel flex min-h-[320px] flex-1 items-center justify-center gap-2.5 text-sm text-[color:var(--muted-foreground)]">
          <Loader2 size={18} className="animate-spin" />正在加载设置...
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex h-full flex-col">
        <div className="wb-panel flex min-h-[320px] flex-1 items-center justify-center text-sm text-[color:var(--muted-foreground)]">
          无法加载设置
        </div>
      </div>
    );
  }

  const prefs = (settings.notificationPrefs as Record<string, boolean> | null) ?? {};

  const handleUpdate = async (updates: Partial<UserSettings>) => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await updateSettings(updates);
      setSuccess('保存成功');
      setTimeout(() => setSuccess(null), 2000);
    } catch {
      setError('保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const toggleNotif = (type: string) => {
    const next: Record<string, boolean> = { ...prefs };
    if (next[type]) { delete next[type]; }
    else { next[type] = false; }
    handleUpdate({ notificationPrefs: Object.keys(next).length ? next : (null as any) });
  };

  return (
    <div className="flex flex-col gap-5 overflow-y-auto">
      {/* ── 外观与导航 ── */}
      <div className="wb-panel">
        <div className="px-6 pt-5 pb-1">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
            <Palette size={12} strokeWidth={1.8} className="text-[color:var(--accent)]" />
            外观与导航
          </h3>
        </div>

        {/* 主题颜色 */}
        <div className="px-6 py-4">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Palette size={14} strokeWidth={1.6} className="shrink-0 text-[color:var(--accent)]" />
                <span className="text-[13px] font-semibold text-[color:var(--foreground)]">主题颜色</span>
              </div>
              <p className="mt-0.5 text-[12px] leading-relaxed text-[color:var(--muted-foreground)]">
                选择偏好的界面配色方案
              </p>
            </div>
            <div className="flex gap-1.5">
              {THEME_OPTIONS.map((option) => (
                <button
                  key={option.value} type="button" disabled={saving}
                  onClick={() => handleUpdate({ theme: option.value })}
                  className={[
                    'rounded-[12px] border px-3.5 py-1.5 text-[12px] font-semibold transition-all duration-200',
                    settings.theme === option.value
                      ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--accent)] shadow-[0_1px_6px_rgba(37,99,235,0.1)]'
                      : 'border-[rgba(96,139,239,0.12)] bg-[rgba(96,139,239,0.04)] text-[color:var(--muted-foreground)] hover:border-[rgba(96,139,239,0.22)] hover:text-[color:var(--foreground)]',
                  ].join(' ')}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <hr className="wb-section-rule mx-6" />

        {/* 紧凑模式 */}
        <div className="px-6 py-4">
          <div className="flex items-center justify-between gap-6">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <LayoutDashboard size={14} strokeWidth={1.6} className="shrink-0 text-[color:var(--accent)]" />
                <span className="text-[13px] font-semibold text-[color:var(--foreground)]">紧凑模式</span>
              </div>
              <p className="mt-0.5 text-[12px] leading-relaxed text-[color:var(--muted-foreground)]">
                减少页面间距，同一屏幕显示更多内容
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleUpdate({ compactMode: !settings.compactMode })}
              disabled={saving}
              className={[
                'relative h-6 w-11 shrink-0 rounded-full transition-all duration-200',
                settings.compactMode ? 'bg-[color:var(--accent)]' : 'bg-[color:var(--border)]',
              ].join(' ')}
            >
              <span className={[
                'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200',
                settings.compactMode ? 'translate-x-5' : '',
              ].join(' ')} />
            </button>
          </div>
        </div>

        <hr className="wb-section-rule mx-6" />

        {/* 默认首页 */}
        <div className="px-6 pb-5 pt-4">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Globe size={14} strokeWidth={1.6} className="shrink-0 text-[color:var(--accent)]" />
                <span className="text-[13px] font-semibold text-[color:var(--foreground)]">默认首页</span>
              </div>
              <p className="mt-0.5 text-[12px] leading-relaxed text-[color:var(--muted-foreground)]">
                登录后自动跳转至此页面
              </p>
            </div>
            <select
              value={settings.defaultHomePage}
              onChange={(e) => handleUpdate({ defaultHomePage: e.target.value as UserSettings['defaultHomePage'] })}
              disabled={saving}
              className="neu-select !w-auto min-w-[140px]"
            >
              {HOME_PAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── 通知类型偏好 ── */}
      {NOTIF_TOGGLES.map((group) => (
        <div key={group.group} className="wb-panel">
          <div className="px-6 pt-5 pb-1">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
              <Bell size={12} strokeWidth={1.8} className="text-[color:var(--accent)]" />
              {group.group}通知
            </h3>
          </div>

          {group.items.map((item, idx) => {
            const enabled = prefs[item.type] !== false; // default to true (undefined or true = enabled)
            const Icon = item.icon;
            return (
              <div key={item.type} className={idx > 0 ? '' : ''}>
                {idx > 0 && <hr className="wb-section-rule mx-6" />}
                <div className="px-6 py-4">
                  <div className="flex items-center justify-between gap-6">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="flex h-6 w-6 items-center justify-center rounded-md"
                          style={{ backgroundColor: enabled ? 'rgba(96,139,239,0.12)' : 'rgba(140,140,140,0.08)' }}
                        >
                          <Icon size={13} style={{ color: enabled ? 'var(--accent)' : 'var(--muted-foreground)' }} />
                        </span>
                        <span className={`text-[13px] font-semibold ${enabled ? 'text-[color:var(--foreground)]' : 'text-[color:var(--muted-foreground)]'}`}>
                          {item.label}
                        </span>
                      </div>
                      <p className="mt-0.5 ml-8 text-[12px] leading-relaxed text-[color:var(--muted-foreground)]">
                        {item.desc}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleNotif(item.type)}
                      disabled={saving}
                      className={[
                        'relative h-6 w-11 shrink-0 rounded-full transition-all duration-200',
                        enabled ? 'bg-[color:var(--accent)]' : 'bg-[color:var(--border)]',
                      ].join(' ')}
                    >
                      <span className={[
                        'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200',
                        enabled ? 'translate-x-5' : '',
                      ].join(' ')} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {success && (
        <div className="flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm"
          style={{ backgroundColor: 'rgba(240,250,245,0.76)', borderColor: 'rgba(92,181,150,0.18)', color: 'var(--success)' }}
        >
          <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-[color:var(--success)]" />
          {success}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm"
          style={{ backgroundColor: 'rgba(255,241,241,0.76)', borderColor: 'rgba(215,89,89,0.18)', color: 'var(--danger)' }}
        >
          <AlertTriangle size={14} strokeWidth={1.6} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}
