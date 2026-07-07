'use client';

import { Loader2, Mail, Building2, UserRound, Shield, AlertTriangle, Check } from 'lucide-react';
import { useState } from 'react';
import { updateMyProfile } from '@/lib/api/auth';
import type { AuthUser, DepartmentItem, UpdateProfileInput } from '@/lib/api/auth';
import { ROLE_LABELS } from '@/lib/role-labels';

function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return '未知';
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch { return '未知'; }
}

interface TabBasicInfoProps {
  user: AuthUser;
  departments: DepartmentItem[];
  onUserUpdated: (updated: AuthUser) => void;
}

export function TabBasicInfo({ user, departments, onUserUpdated }: TabBasicInfoProps) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email ?? '');
  const [departmentId, setDepartmentId] = useState(user.department?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const hasChanges =
    displayName !== user.displayName ||
    email !== (user.email ?? '') ||
    departmentId !== (user.department?.id ?? '');

  const handleSave = async () => {
    setError(null);
    setSuccess(null);

    if (!displayName.trim()) { setError('姓名不能为空'); return; }
    if (displayName.trim().length > 32) { setError('姓名不能超过 32 个字符'); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('邮箱格式不正确'); return; }

    setSaving(true);
    try {
      const payload: UpdateProfileInput = {};
      if (displayName !== user.displayName) payload.displayName = displayName.trim();
      if (email !== (user.email ?? '')) payload.email = email.trim() || null;
      if (departmentId !== (user.department?.id ?? '')) payload.departmentId = departmentId || null;

      const updated = await updateMyProfile(payload);
      onUserUpdated(updated);
      setSuccess('保存成功');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Read-only account info */}
      <div className="neu-card-static p-5">
        <h3 className="neu-section-heading">账号信息</h3>
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-3 rounded-xl border border-white/50 bg-white/42 p-3">
            <Shield size={16} strokeWidth={1.6} className="shrink-0 text-[color:var(--muted-foreground)]" />
            <span className="text-sm text-[color:var(--muted-foreground)]">用户名</span>
            <span className="ml-auto text-sm font-medium text-[color:var(--foreground)]">{user.username}</span>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-white/50 bg-white/42 p-3">
            <UserRound size={16} strokeWidth={1.6} className="shrink-0 text-[color:var(--muted-foreground)]" />
            <span className="text-sm text-[color:var(--muted-foreground)]">角色</span>
            <span className="ml-auto inline-block rounded-full border border-[color:var(--accent-soft)] bg-[color:var(--accent-soft)] px-2 py-0.5 text-[11px] font-semibold tracking-[0.04em] text-[color:var(--accent-strong)]">
              {ROLE_LABELS[user.role] ?? user.role}
            </span>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-white/50 bg-white/42 p-3">
            <UserRound size={16} strokeWidth={1.6} className="shrink-0 text-[color:var(--muted-foreground)]" />
            <span className="text-sm text-[color:var(--muted-foreground)]">创建时间</span>
            <span className="ml-auto text-sm font-medium text-[color:var(--foreground)]">{formatDate(user.createdAt)}</span>
          </div>
        </div>
      </div>

      {/* Edit form */}
      <div className="neu-card-static p-5">
        <h3 className="neu-section-heading">编辑资料</h3>

        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[color:var(--foreground)]">姓名</span>
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
              placeholder="请输入姓名" className="neu-input w-full" maxLength={32} />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[color:var(--foreground)]">
              <Mail size={14} strokeWidth={1.6} className="mr-1.5 inline-block text-[color:var(--muted-foreground)]" />
              邮箱
            </span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="请输入邮箱地址" className="neu-input w-full" />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-[color:var(--foreground)]">
              <Building2 size={14} strokeWidth={1.6} className="mr-1.5 inline-block text-[color:var(--muted-foreground)]" />
              部门
            </span>
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="neu-select w-full">
              <option value="">未设置</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>{dept.name}</option>
              ))}
            </select>
          </label>
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-[rgba(215,89,89,0.18)] bg-[rgba(255,241,241,0.76)] px-4 py-3 text-sm text-[color:var(--danger)]">
            <AlertTriangle size={14} strokeWidth={1.6} className="mt-0.5 shrink-0" />{error}
          </div>
        )}
        {success && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-[rgba(92,181,150,0.18)] bg-[rgba(240,250,245,0.76)] px-4 py-3 text-sm text-[color:var(--success)]">
            <Check size={14} strokeWidth={1.6} className="mt-0.5 shrink-0" />{success}
          </div>
        )}

        <div className="mt-5">
          <button type="button" onClick={handleSave} disabled={saving || !hasChanges}
            className="neu-btn-primary disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? <><Loader2 size={16} className="animate-spin" />保存中...</> : '保存修改'}
          </button>
        </div>
      </div>
    </div>
  );
}
