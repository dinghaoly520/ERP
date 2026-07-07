'use client';

import { Loader2, KeyRound, Clock, AlertTriangle, Check } from 'lucide-react';
import { useState } from 'react';
import { requestPasswordChange } from '@/lib/api/auth';
import type { AuthUser } from '@/lib/api/auth';

interface TabSecurityProps {
  user: AuthUser;
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
    <div className="flex flex-1 flex-col gap-5">
      {/* Password change — wb-panel */}
      <div className="wb-panel p-6">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
          <KeyRound size={12} strokeWidth={1.8} className="text-[color:var(--accent)]" />
          修改密码
        </h3>
        <p className="mt-3 text-[13px] leading-relaxed text-[color:var(--muted-foreground)]">
          提交申请后需等待管理员审批，审批通过后新密码生效。
        </p>

        <form onSubmit={handleSubmit} noValidate className="mt-5 max-w-md space-y-4">
          <label className="block">
            <span className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-[color:var(--foreground)]">
              <KeyRound size={13} strokeWidth={1.7} className="text-[color:var(--muted-foreground)]" />
              当前密码
            </span>
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="请输入当前密码" className="neu-input w-full" autoComplete="current-password" />
          </label>
          <label className="block">
            <span className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-[color:var(--foreground)]">
              新密码
            </span>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              placeholder="不少于 6 位" className="neu-input w-full" autoComplete="new-password" />
          </label>
          <label className="block">
            <span className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-[color:var(--foreground)]">
              确认新密码
            </span>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="请再次输入新密码" className="neu-input w-full" autoComplete="new-password" />
          </label>

          {error && (
            <div className="flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm"
              style={{
                backgroundColor: 'rgba(255,241,241,0.76)',
                borderColor: 'rgba(215,89,89,0.18)',
                color: 'var(--danger)',
              }}
            >
              <AlertTriangle size={14} strokeWidth={1.6} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}
          {success && (
            <div className="flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm"
              style={{
                backgroundColor: 'rgba(240,250,245,0.76)',
                borderColor: 'rgba(92,181,150,0.18)',
                color: 'var(--success)',
              }}
            >
              <Check size={14} strokeWidth={1.6} className="mt-0.5 shrink-0" />
              {success}
            </div>
          )}

          <div className="pt-1">
            <button type="submit" disabled={submitting} className="neu-btn-primary self-start">
              {submitting ? <><Loader2 size={16} className="animate-spin" />提交中...</> : '提交审批'}
            </button>
          </div>
        </form>
      </div>

      {/* Login info — compact wb-panel */}
      <div className="wb-panel p-6">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
          <Clock size={12} strokeWidth={1.8} className="text-[color:var(--accent)]" />
          登录信息
        </h3>
        <div className="mt-4">
          <div className="neu-content-block flex items-center gap-3 rounded-xl px-4 py-3.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]"
              style={{
                backgroundColor: 'rgba(96,139,239,0.1)',
                color: 'var(--accent)',
              }}
            >
              <Clock size={16} strokeWidth={1.6} />
            </div>
            <div>
              <div className="text-[13px] font-medium text-[color:var(--foreground)]">登录功能正常运行中</div>
              <div className="mt-0.5 text-[11px] text-[color:var(--muted-foreground)]">会话安全，可随时修改密码</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
