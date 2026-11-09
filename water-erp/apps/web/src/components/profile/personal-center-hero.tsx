'use client';

import { useEffect, useState } from 'react';
import {
  LogOut, Loader2, Mail, Phone, UserRound, Building2, Building, Monitor, Users,
  ShieldCheck, CalendarClock, Calendar, Settings, X, Clock,
} from 'lucide-react';
import type { AuthUser } from '@/lib/api/auth';
import { fetchLoginHistory, type LoginHistoryItem } from '@/lib/api/auth';
import { ROLE_LABELS } from '@/lib/role-labels';

function formatLoginTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) + ' ' +
    d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function parseBrowser(ua: string | null): string {
  if (!ua) return '未知';
  if (ua.includes('Edg')) return 'Edge';
  if (ua.includes('Chrome')) return 'Chrome';
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Safari')) return 'Safari';
  return ua.split(' ')[0]?.slice(0, 12) || '未知';
}

interface PersonalCenterHeroProps {
  user: AuthUser;
  onOpenBasicInfo: () => void;
  onOpenPreferences: () => void;
  onOpenMemberList: () => void;
  onLogout: () => void;
  loggingOut: boolean;
}

export function PersonalCenterHero({ user, onOpenBasicInfo, onOpenPreferences, onOpenMemberList, onLogout, loggingOut }: PersonalCenterHeroProps) {
  const [showLoginHistory, setShowLoginHistory] = useState(false);
  const [loginHistory, setLoginHistory] = useState<LoginHistoryItem[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const openLoginHistory = () => {
    setShowLoginHistory(true);
    if (loginHistory !== null) return;
    setLoadingHistory(true);
    fetchLoginHistory().then(data => setLoginHistory(data))
      .catch(() => setLoginHistory([]))
      .finally(() => setLoadingHistory(false));
  };

  const createdAtLabel = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';

  return (
    <div className="page-hero">
      {/* ══ 行 1：身份信息 + 操作 ══ */}
      <div className="page-hero__row">
        <div className="page-hero__left">
          {user.avatar ? (
            <div className="h-[52px] w-[52px] overflow-hidden rounded-[14px]">
              <img src={user.avatar} alt={user.displayName} className="h-full w-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            </div>
          ) : (
            <div className="page-hero__icon">
              <UserRound size={20} strokeWidth={1.6} />
            </div>
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="page-hero__title">{user.displayName}</span>
              <span className="inline-flex items-center rounded-[8px] px-2 py-0.5 text-[10px] font-bold tracking-[0.04em]"
                style={{ backgroundColor: 'rgba(96,139,239,0.12)', color: 'var(--accent)' }}>
                {ROLE_LABELS[user.role] ?? user.role}
              </span>
              {/* 登录用户名瓷片（原「用户名」KPI 卡融入，2026-11-09） */}
              <span className="inline-flex items-center rounded-md bg-[color-mix(in_oklch,var(--muted-foreground)_9%,transparent)] px-2 py-0.5 align-middle font-mono text-[12px] font-medium tracking-wide text-[color:var(--muted-foreground)]"
                title="登录用户名">{user.username}</span>
            </div>
            <div className="page-hero__sub flex flex-wrap items-center gap-x-3 gap-y-0.5">
              <span className="inline-flex items-center gap-1"><Building size={11} strokeWidth={1.6} />{user.company ?? '未设置公司'}</span>
              <span className="text-[color:var(--muted-foreground)]/40">·</span>
              <span className="inline-flex items-center gap-1"><Building2 size={11} strokeWidth={1.6} />{user.department?.name ?? '未设置部门'}</span>
              <span className="text-[color:var(--muted-foreground)]/40">·</span>
              <span className="inline-flex items-center gap-1"><Mail size={11} strokeWidth={1.6} />{user.email ?? '未绑定邮箱'}</span>
              <span className="text-[color:var(--muted-foreground)]/40">·</span>
              <span className="inline-flex items-center gap-1"><Phone size={11} strokeWidth={1.6} />{user.phone ?? '未绑定手机'}</span>
              <span className="text-[color:var(--muted-foreground)]/40">·</span>
              {/* 创建时间（原「账号创建」KPI 卡融入，2026-11-09） */}
              <span className="inline-flex items-center gap-1"><Calendar size={11} strokeWidth={1.6} />创建于 {createdAtLabel}</span>
            </div>
          </div>
        </div>

        <div className="page-hero__right flex-wrap">
          {/* 状态瓷片（原「当前会话/安全状态」KPI 卡融入，2026-11-09；
              与其他页 hero 同形态：瓷片居按钮前同行内联、垂直居中） */}
          <span className="page-hero__stat page-hero__stat--info" title="当前会话状态">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)]" />活跃中
          </span>
          <span className={`page-hero__stat ${user.isFrozen ? 'page-hero__stat--warn' : 'page-hero__stat--info'}`} title="账号安全状态">
            <ShieldCheck size={11} strokeWidth={2} />{user.isFrozen ? '已冻结' : '安全正常'}
          </span>
          <button onClick={onOpenBasicInfo} type="button" className="neu-btn-soft">
            <UserRound size={14} strokeWidth={1.7} />基本资料与安全
          </button>
          <button onClick={onOpenPreferences} type="button" className="neu-btn-soft">
            <Settings size={14} strokeWidth={1.7} />偏好设置
          </button>
          <button onClick={openLoginHistory} type="button" className="neu-btn-soft">
            <CalendarClock size={14} strokeWidth={1.7} />近期登录
          </button>
          <button onClick={onOpenMemberList} className="neu-btn-soft" type="button">
            <Users size={14} strokeWidth={1.7} />通讯联络
          </button>
          <button onClick={onLogout} disabled={loggingOut} type="button"
            className="neu-btn-soft is-danger disabled:cursor-not-allowed disabled:opacity-55">
            {loggingOut ? <><Loader2 size={14} className="animate-spin" />退出中</> : <><LogOut size={14} strokeWidth={1.7} />退出登录</>}
          </button>
        </div>
      </div>

      {/* 标题行下长横线（2026-11-09 用户裁定：与其他页 hero 一致，公司信息管理同款 page-hero__divider） */}
      <div className="page-hero__divider" />

      {/* ══ 近期登录记录弹窗 ══ */}
      {showLoginHistory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm" onClick={() => setShowLoginHistory(false)} />
          <div className="relative w-full max-w-[min(640px,92vw)] max-h-[80vh] overflow-y-auto rounded-[20px] bg-[var(--background)] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.12)]" role="dialog" aria-modal="true">
            <div className="flex items-start justify-between gap-4 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="neu-icon-well flex h-9 w-9 items-center justify-center rounded-[10px]">
                  <CalendarClock size={15} className="text-[var(--accent)]" />
                </div>
                <div>
                  <h2 className="text-sm font-extrabold text-[var(--foreground)]">近期登录记录</h2>
                  <p className="text-[11px] text-[var(--muted-foreground)]">展示账号最近的登录活动</p>
                </div>
              </div>
              <button onClick={() => setShowLoginHistory(false)} className="neu-btn-xs" aria-label="关闭">
                <X size={14} />
              </button>
            </div>

            <hr className="wb-section-rule" />

            {loadingHistory ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10">
                <Loader2 size={20} className="animate-spin text-[var(--accent)]" />
                <span className="text-[13px] text-[var(--muted-foreground)]">正在加载登录记录...</span>
              </div>
            ) : !loginHistory || loginHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10">
                <div className="neu-icon-well flex h-12 w-12 items-center justify-center rounded-xl">
                  <Clock size={20} className="text-[var(--muted-foreground)]" />
                </div>
                <span className="text-[13px] text-[var(--muted-foreground)]">暂无登录记录</span>
              </div>
            ) : (
              <div className="neu-table-card mt-4 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="neu-table w-full">
                    <thead>
                      <tr>
                        <th>设备/浏览器</th>
                        <th>IP 地址</th>
                        <th className="text-right">登录时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loginHistory.map(entry => (
                        <tr key={entry.id}>
                          <td>
                            <div className="flex items-center gap-2">
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[oklch(0.55_0.03_258/0.06)]">
                                <Monitor size={11} strokeWidth={1.6} className="text-[var(--muted-foreground)]" />
                              </span>
                              <span className="text-[12px] font-semibold text-[var(--foreground)]">{parseBrowser(entry.userAgent)}</span>
                            </div>
                          </td>
                          <td className="font-mono text-[11px] tabular-nums text-[var(--muted-foreground)]">{entry.ipAddress || '—'}</td>
                          <td className="text-right text-[11px] tabular-nums text-[var(--muted-foreground)]">{formatLoginTime(entry.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
