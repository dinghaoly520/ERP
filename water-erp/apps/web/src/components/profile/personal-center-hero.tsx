'use client';

import { LogOut, Loader2, UserRound } from 'lucide-react';
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
  user: AuthUser & { department?: { id: string; name: string; code: string | null } | null };
  onEdit: () => void;
  onChangePassword: () => void;
  onLogout: () => void;
  loggingOut: boolean;
}

export function PersonalCenterHero({ user, onEdit, onChangePassword, onLogout, loggingOut }: PersonalCenterHeroProps) {
  return (
    <div className="neu-card-static w-[280px] shrink-0 self-start p-5">
      {/* Avatar */}
      <div className="flex flex-col items-center gap-3">
        <div className="neu-icon-well flex h-16 w-16 items-center justify-center">
          <UserRound size={30} strokeWidth={1.6} className="text-[color:var(--accent)]" />
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">
            {user.displayName}
          </div>
          <div className="mt-1">
            <span className="inline-block rounded-full border border-[color:var(--accent-soft)] bg-[color:var(--accent-soft)] px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.04em] text-[color:var(--accent-strong)]">
              {ROLE_LABELS[user.role] ?? user.role}
            </span>
          </div>
        </div>
      </div>

      {/* Info rows */}
      <div className="mt-5 space-y-3 rounded-xl border border-white/60 bg-white/42 p-3.5">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-[color:var(--muted-foreground)]">用户名</span>
          <span className="font-medium text-[color:var(--foreground)]">{user.username}</span>
        </div>
        <div className="h-px bg-[linear-gradient(90deg,rgba(180,200,235,0.32),rgba(180,200,235,0.08))]" />
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-[color:var(--muted-foreground)]">部门</span>
          <span className="font-medium text-[color:var(--foreground)]">
            {user.department?.name ?? '未设置'}
          </span>
        </div>
        <div className="h-px bg-[linear-gradient(90deg,rgba(180,200,235,0.32),rgba(180,200,235,0.08))]" />
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-[color:var(--muted-foreground)]">邮箱</span>
          <span className="font-medium text-[color:var(--foreground)]">
            {user.email ?? '未设置'}
          </span>
        </div>
        <div className="h-px bg-[linear-gradient(90deg,rgba(180,200,235,0.32),rgba(180,200,235,0.08))]" />
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-[color:var(--muted-foreground)]">创建时间</span>
          <span className="font-medium text-[color:var(--foreground)]">{formatDate(user.createdAt)}</span>
        </div>
      </div>

      {/* Quick actions */}
      <div className="mt-4 space-y-2">
        <button type="button" onClick={onEdit} className="neu-btn-soft w-full justify-center text-sm">
          编辑资料
        </button>
        <button type="button" onClick={onChangePassword} className="neu-btn-soft w-full justify-center text-sm">
          修改密码
        </button>
      </div>

      {/* Logout */}
      <div className="mt-3">
        <button
          type="button"
          onClick={onLogout}
          disabled={loggingOut}
          className="neu-btn-soft is-danger w-full justify-center text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loggingOut ? (
            <><Loader2 size={15} className="animate-spin" />退出中...</>
          ) : (
            <><LogOut size={15} strokeWidth={1.8} />退出登录</>
          )}
        </button>
      </div>
    </div>
  );
}
