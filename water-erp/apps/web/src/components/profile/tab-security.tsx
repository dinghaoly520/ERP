'use client';

import { Loader2, Clock } from 'lucide-react';
import { useState } from 'react';
import { requestPasswordChange } from '@/lib/api/auth';

function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '从未登录';
  try {
    const date = new Date(isoString);
    return date.toLocaleString('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return '未知'; }
}

interface TabSecurityProps {
  user: { lastLoginAt?: string | null };
}

export function TabSecurity({ user }: TabSecurityProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!currentPassword) { setError('请输入当前密码'); return; }
    if (!newPassword) { setError('请输入新密码'); return; }
    if (newPassword.length < 6) { setError('新密码至少需要 6 位'); return; }
    if (newPassword !== confirmPassword) { setError('两次输入的新密码不一致'); return; }

    setSubmitting(true);
    try {
      await requestPasswordChange({ currentPassword, newPassword });
      setSuccess('申请已提交，等待管理员审批通过后新密码才会生效。');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Password change */}
      <div className="neu-card-static p-5">
        <h3 className="neu-section-heading">修改密码</h3>
        <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
          提交申请后需等待管理员审批，审批通过后新密码生效。
        </p>

        <form onSubmit={handleSubmit} noValidate className="mt-5 max-w-md space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[color:var(--foreground)]">当前密码</span>
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="请输入当前密码" className="neu-input w-full" autoComplete="current-password" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[color:var(--foreground)]">新密码</span>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              placeholder="不少于 6 位" className="neu-input w-full" autoComplete="new-password" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[color:var(--foreground)]">确认新密码</span>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="请再次输入新密码" className="neu-input w-full" autoComplete="new-password" />
          </label>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-[rgba(215,89,89,0.18)] bg-[rgba(255,241,241,0.76)] px-4 py-3 text-sm text-[color:var(--danger)]">
              <span className="mt-0.5 shrink-0">⚠</span>{error}
            </div>
          )}
          {success && (
            <div className="flex items-start gap-2 rounded-xl border border-[rgba(92,181,150,0.18)] bg-[rgba(240,250,245,0.76)] px-4 py-3 text-sm text-[color:var(--success)]">
              <span className="mt-0.5 shrink-0">✓</span>{success}
            </div>
          )}

          <button type="submit" disabled={submitting} className="neu-btn-primary">
            {submitting ? <><Loader2 size={16} className="animate-spin" />提交中...</> : '提交审批'}
          </button>
        </form>
      </div>

      {/* Login info */}
      <div className="neu-card-static p-5">
        <h3 className="neu-section-heading">登录信息</h3>
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-3 rounded-xl border border-white/50 bg-white/42 p-3.5">
            <Clock size={16} strokeWidth={1.6} className="shrink-0 text-[color:var(--muted-foreground)]" />
            <span className="text-sm text-[color:var(--muted-foreground)]">最近登录</span>
            <span className="ml-auto text-sm font-medium text-[color:var(--foreground)]">
              {formatDateTime(user.lastLoginAt)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
