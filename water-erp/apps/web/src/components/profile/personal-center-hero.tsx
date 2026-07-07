'use client';

import { CalendarDays, LogOut, Loader2, Mail, Phone, MapPin, UserRound, Building2 } from 'lucide-react';
import type { AuthUser } from '@/lib/api/auth';
import { ROLE_LABELS } from '@/lib/role-labels';

function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return '未知';
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return '未知';
  }
}

interface PersonalCenterHeroProps {
  user: AuthUser;
  onEdit: () => void;
  onChangePassword: () => void;
  onLogout: () => void;
  loggingOut: boolean;
}

export function PersonalCenterHero({ user, onEdit, onChangePassword, onLogout, loggingOut }: PersonalCenterHeroProps) {
  return (
    <div className="wb-panel flex w-[280px] shrink-0 flex-col self-stretch overflow-hidden">
      {/* Identity banner */}
      <div className="relative flex flex-col items-center gap-3 px-5 pb-4 pt-6">
        <div
          className="absolute inset-x-0 top-0 h-[3px]"
          style={{
            background: 'linear-gradient(90deg, transparent, var(--accent) 20%, var(--accent-strong) 50%, var(--accent) 80%, transparent)',
          }}
        />

        <div className="neu-icon-well flex h-[72px] w-[72px] items-center justify-center rounded-[20px]">
          <UserRound size={36} strokeWidth={1.4} className="text-[color:var(--accent)]" />
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold tracking-[-0.03em] text-[color:var(--foreground)]">
            {user.displayName}
          </div>
          <div className="mt-1.5">
            <span className="inline-flex items-center rounded-[10px] border px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.04em]"
              style={{
                backgroundColor: 'rgba(96,139,239,0.12)',
                color: 'var(--accent)',
                borderColor: 'rgba(96,139,239,0.25)',
              }}
            >
              {ROLE_LABELS[user.role] ?? user.role}
            </span>
          </div>
        </div>
      </div>

      <hr className="wb-section-rule mx-5" />

      {/* Info rows */}
      <div className="flex-1 space-y-0.5 px-5 pb-2">
        <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-[rgba(96,139,239,0.04)]">
          <UserRound size={14} strokeWidth={1.6} className="shrink-0 text-[color:var(--muted-foreground)]" />
          <span className="text-[color:var(--muted-foreground)]">用户名</span>
          <span className="ml-auto font-medium tabular-nums text-[color:var(--foreground)]">{user.username}</span>
        </div>

        <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-[rgba(96,139,239,0.04)]">
          <Building2 size={14} strokeWidth={1.6} className="shrink-0 text-[color:var(--muted-foreground)]" />
          <span className="text-[color:var(--muted-foreground)]">部门</span>
          <span className="ml-auto max-w-[110px] truncate text-right font-medium text-[color:var(--foreground)]">
            {user.department?.name ?? '未设置'}
          </span>
        </div>

        <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-[rgba(96,139,239,0.04)]">
          <Mail size={14} strokeWidth={1.6} className="shrink-0 text-[color:var(--muted-foreground)]" />
          <span className="text-[color:var(--muted-foreground)]">邮箱</span>
          <span className="ml-auto max-w-[120px] truncate text-right font-medium text-[color:var(--foreground)]">
            {user.email ?? '未设置'}
          </span>
        </div>

        <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-[rgba(96,139,239,0.04)]">
          <Phone size={14} strokeWidth={1.6} className="shrink-0 text-[color:var(--muted-foreground)]" />
          <span className="text-[color:var(--muted-foreground)]">手机</span>
          <span className="ml-auto font-medium tabular-nums text-[color:var(--foreground)]">
            {user.phone ?? '未设置'}
          </span>
        </div>

        <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-[rgba(96,139,239,0.04)]">
          <MapPin size={14} strokeWidth={1.6} className="shrink-0 text-[color:var(--muted-foreground)]" />
          <span className="text-[color:var(--muted-foreground)]">办公位置</span>
          <span className="ml-auto max-w-[100px] truncate text-right font-medium text-[color:var(--foreground)]">
            {user.officeLocation ?? '未设置'}
          </span>
        </div>

        <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors hover:bg-[rgba(96,139,239,0.04)]">
          <CalendarDays size={14} strokeWidth={1.6} className="shrink-0 text-[color:var(--muted-foreground)]" />
          <span className="text-[color:var(--muted-foreground)]">创建时间</span>
          <span className="ml-auto font-medium tabular-nums text-[color:var(--foreground)]">{formatDate(user.createdAt)}</span>
        </div>
      </div>

      <hr className="wb-section-rule mx-5" />

      {/* Quick actions */}
      <div className="space-y-1.5 px-5 pb-1">
        <button type="button" onClick={onEdit} className="neu-btn-soft w-full justify-center text-[13px]">
          编辑资料
        </button>
        <button type="button" onClick={onChangePassword} className="neu-btn-soft w-full justify-center text-[13px]">
          修改密码
        </button>
      </div>

      {/* Logout */}
      <div className="px-5 pb-5 pt-2">
        <button
          type="button"
          onClick={onLogout}
          disabled={loggingOut}
          className="neu-btn-soft is-danger w-full justify-center text-[13px] disabled:cursor-not-allowed disabled:opacity-55"
        >
          {loggingOut ? (
            <><Loader2 size={14} className="animate-spin" />退出中...</>
          ) : (
            <><LogOut size={14} strokeWidth={1.6} />退出登录</>
          )}
        </button>
      </div>
    </div>
  );
}
