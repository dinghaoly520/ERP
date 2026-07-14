'use client';

import { useEffect, useState } from 'react';
import {
  LogOut, Loader2, Mail, Phone, UserRound, Building2, Monitor, Edit3, KeyRound,
} from 'lucide-react';
import type { AuthUser } from '@/lib/api/auth';
import { fetchLoginHistory, type LoginHistoryItem } from '@/lib/api/auth';
import { ROLE_LABELS } from '@/lib/role-labels';

function formatLoginTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function parseBrowser(ua: string | null): string {
  if (!ua) return '未知';
  if (ua.includes('Chrome')) return 'Chrome';
  if (ua.includes('Safari')) return 'Safari';
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Edge')) return 'Edge';
  return ua.split(' ')[0]?.slice(0, 12) || '未知';
}

interface PersonalCenterHeroProps {
  user: AuthUser;
  onEdit: () => void;
  onChangePassword: () => void;
  onLogout: () => void;
  loggingOut: boolean;
}

export function PersonalCenterHero({ user, onEdit, onChangePassword, onLogout, loggingOut }: PersonalCenterHeroProps) {
  const [loginHistory, setLoginHistory] = useState<LoginHistoryItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchLoginHistory().then((data) => {
      if (!cancelled) {
        // Deduplicate: only show unique browser entries
        const seen = new Set<string>();
        const unique: typeof data = [];
        for (const entry of data) {
          const key = parseBrowser(entry.userAgent);
          if (!seen.has(key)) { seen.add(key); unique.push(entry); }
        }
        setLoginHistory(unique.slice(0, 2));
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="wb-panel flex flex-col gap-4 px-4 py-5">
      {/* Avatar + Name + Role */}
      <div className="flex flex-col items-center gap-3">
        {user.avatar ? (
          <div className="h-[64px] w-[64px] overflow-hidden rounded-[18px] border-2 border-[rgba(96,139,239,0.2)] shadow-sm">
            <img src={user.avatar} alt={user.displayName} className="h-full w-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          </div>
        ) : (
          <div className="neu-icon-well flex h-[64px] w-[64px] items-center justify-center rounded-[18px]">
            <UserRound size={32} strokeWidth={1.4} className="text-[color:var(--accent)]" />
          </div>
        )}
        <div className="text-center">
          <div className="text-[15px] font-bold tracking-[-0.03em] text-[color:var(--foreground)]">
            {user.displayName}
          </div>
          <div className="mt-1">
            <span className="inline-flex items-center rounded-[8px] px-2 py-0.5 text-[10px] font-bold tracking-[0.03em]"
              style={{
                backgroundColor: 'rgba(96,139,239,0.12)',
                color: 'var(--accent)',
              }}
            >
              {ROLE_LABELS[user.role] ?? user.role}
            </span>
          </div>
        </div>
      </div>

      <hr className="wb-section-rule" />

      {/* Essential info */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12px] transition-colors hover:bg-[rgba(96,139,239,0.04)]">
          <Building2 size={13} className="shrink-0 text-[color:var(--muted-foreground)]" />
          <span className="min-w-0 flex-1 truncate font-medium text-[color:var(--foreground)]">
            {user.department?.name ?? '未设置部门'}
          </span>
        </div>
        <div className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12px] transition-colors hover:bg-[rgba(96,139,239,0.04)]">
          <Mail size={13} className="shrink-0 text-[color:var(--muted-foreground)]" />
          <span className="min-w-0 flex-1 truncate font-medium text-[color:var(--foreground)]">
            {user.email ?? '未设置邮箱'}
          </span>
        </div>
        <div className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12px] transition-colors hover:bg-[rgba(96,139,239,0.04)]">
          <Phone size={13} className="shrink-0 text-[color:var(--muted-foreground)]" />
          <span className="min-w-0 flex-1 truncate font-medium text-[color:var(--foreground)]">
            {user.phone ?? '未设置手机'}
          </span>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex flex-col gap-1.5">
        <button type="button" onClick={onEdit} className="neu-btn-soft w-full justify-center text-[12px]">
          <Edit3 size={12} />编辑资料
        </button>
        <button type="button" onClick={onChangePassword} className="neu-btn-soft w-full justify-center text-[12px]">
          <KeyRound size={12} />修改密码
        </button>
      </div>

      {/* Login devices */}
      {loginHistory.length > 0 && (
        <>
          <hr className="wb-section-rule" />
          <div className="flex flex-col gap-0.5">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold text-[color:var(--muted-foreground)]">
              <Monitor size={11} />登录设备
            </div>
            {loginHistory.slice(0, 2).map((entry) => (
              <div key={entry.id} className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px]">
                <span className="h-1 w-1 flex-shrink-0 rounded-full bg-[#11a874]" />
                <span className="flex-1 truncate text-[color:var(--foreground)]">
                  {parseBrowser(entry.userAgent)}
                </span>
                <span className="flex-shrink-0 tabular-nums text-[color:var(--muted-foreground)]">
                  {formatLoginTime(entry.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Logout */}
      <hr className="wb-section-rule" />
      <button
        type="button"
        onClick={onLogout}
        disabled={loggingOut}
        className="neu-btn-soft is-danger w-full justify-center text-[12px] disabled:cursor-not-allowed disabled:opacity-55"
      >
        {loggingOut ? (
          <><Loader2 size={12} className="animate-spin" />退出中...</>
        ) : (
          <><LogOut size={12} strokeWidth={1.6} />退出登录</>
        )}
      </button>
    </div>
  );
}
