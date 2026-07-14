'use client';

import { Loader2, Mail, Phone, MapPin, Building2, UserRound, Shield, AlertTriangle, Check, Camera, Upload } from 'lucide-react';
import { useState, useRef } from 'react';
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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface TabBasicInfoProps {
  user: AuthUser;
  departments: DepartmentItem[];
  onUserUpdated: (updated: AuthUser) => void;
}

export function TabBasicInfo({ user, departments, onUserUpdated }: TabBasicInfoProps) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email ?? '');
  const [phone, setPhone] = useState(user.phone ?? '');
  const [officeLocation, setOfficeLocation] = useState(user.officeLocation ?? '');
  const [departmentId, setDepartmentId] = useState(user.department?.id ?? '');
  const [avatar, setAvatar] = useState(user.avatar ?? '');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const hasChanges =
    displayName !== user.displayName ||
    email !== (user.email ?? '') ||
    phone !== (user.phone ?? '') ||
    officeLocation !== (user.officeLocation ?? '') ||
    departmentId !== (user.department?.id ?? '') ||
    avatar !== (user.avatar ?? '');

  const handleSave = async () => {
    setError(null);
    setSuccess(null);

    if (!displayName.trim()) { setError('姓名不能为空'); return; }
    if (displayName.trim().length > 32) { setError('姓名不能超过 32 个字符'); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('邮箱格式不正确'); return; }
    if (phone && !/^[\d\-+() ]{7,20}$/.test(phone)) { setError('手机号码格式不正确'); return; }

    setSaving(true);
    try {
      const payload: UpdateProfileInput = {};
      if (displayName !== user.displayName) payload.displayName = displayName.trim();
      if (email !== (user.email ?? '')) payload.email = email.trim() || null;
      if (phone !== (user.phone ?? '')) payload.phone = phone.trim() || null;
      if (officeLocation !== (user.officeLocation ?? '')) payload.officeLocation = officeLocation.trim() || null;
      if (departmentId !== (user.department?.id ?? '')) payload.departmentId = departmentId || null;
      if (avatar !== (user.avatar ?? '')) payload.avatar = avatar.trim() || null;

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
    <div className="flex flex-col gap-5 overflow-y-auto">
      {/* Read-only account info */}
      <div className="wb-panel p-6">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
          <Shield size={12} strokeWidth={1.8} className="text-[color:var(--accent)]" />
          账号信息
        </h3>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="kpi-card px-4 py-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[color:var(--muted-foreground)]">用户名</div>
            <div className="mt-1.5 flex items-center gap-2">
              <UserRound size={14} strokeWidth={1.6} className="shrink-0 text-[color:var(--muted-foreground)]" />
              <span className="text-sm font-semibold tracking-[-0.01em] text-[color:var(--foreground)]">{user.username}</span>
            </div>
          </div>

          <div className="kpi-card px-4 py-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[color:var(--muted-foreground)]">角色</div>
            <div className="mt-1.5">
              <span className="inline-flex items-center rounded-[10px] border px-2 py-0.5 text-[11px] font-semibold tracking-[0.04em]"
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

          <div className="kpi-card px-4 py-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[color:var(--muted-foreground)]">部门</div>
            <div className="mt-1.5 text-sm font-semibold tracking-[-0.01em] text-[color:var(--foreground)]">
              {user.department?.name ?? '未设置'}
            </div>
          </div>

          <div className="kpi-card px-4 py-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[color:var(--muted-foreground)]">创建时间</div>
            <div className="mt-1.5 text-sm font-semibold tabular-nums tracking-[-0.01em] text-[color:var(--foreground)]">
              {formatDate(user.createdAt)}
            </div>
          </div>
        </div>
      </div>

      {/* Edit form */}
      <div className="wb-panel flex-1 p-6">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
          <UserRound size={12} strokeWidth={1.8} className="text-[color:var(--accent)]" />
          编辑资料
        </h3>

        {/* Avatar */}
        <div className="mt-5 flex items-center gap-5">
          <div className="flex-shrink-0">
            {avatar ? (
              <div className="h-[80px] w-[80px] overflow-hidden rounded-[18px] border-2 border-[rgba(96,139,239,0.2)] shadow-sm">
                <img src={avatar} alt="头像" className="h-full w-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              </div>
            ) : (
              <div className="neu-icon-well flex h-[80px] w-[80px] items-center justify-center rounded-[18px]">
                <Camera size={28} className="text-[color:var(--muted-foreground)] opacity-40" />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold text-[color:var(--foreground)]">头像照片</span>
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setAvatarUploading(true);
                  try {
                    const b64 = await fileToBase64(file);
                    setAvatar(b64);
                  } catch {
                    setError('图片处理失败，请重试');
                  } finally {
                    setAvatarUploading(false);
                  }
                }}
              />
              <button type="button" onClick={() => fileRef.current?.click()}
                disabled={avatarUploading}
                className="neu-btn-xs">
                {avatarUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                {avatar ? '更换图片' : '上传图片'}
              </button>
              <input
                type="url"
                value={avatar}
                onChange={(e) => setAvatar(e.target.value)}
                placeholder="或输入图片 URL"
                className="neu-input w-[220px] text-xs" />
            </div>
            <span className="text-[10px] text-[color:var(--muted-foreground)]">
              JPG/PNG 格式，支持本地上传或粘贴图片链接
            </span>
          </div>
        </div>

        <hr className="wb-section-rule" />

        <div className="grid gap-5 sm:grid-cols-2">
          {/* Display name */}
          <label className="block">
            <span className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-[color:var(--foreground)]">
              <UserRound size={13} strokeWidth={1.7} className="text-[color:var(--muted-foreground)]" />
              姓名
            </span>
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
              placeholder="请输入姓名" className="neu-input w-full" maxLength={32} />
          </label>

          {/* Email */}
          <label className="block">
            <span className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-[color:var(--foreground)]">
              <Mail size={13} strokeWidth={1.7} className="text-[color:var(--muted-foreground)]" />
              邮箱
            </span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="请输入邮箱地址" className="neu-input w-full" />
          </label>

          {/* Phone */}
          <label className="block">
            <span className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-[color:var(--foreground)]">
              <Phone size={13} strokeWidth={1.7} className="text-[color:var(--muted-foreground)]" />
              手机号码
            </span>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
              placeholder="请输入手机号码" className="neu-input w-full" />
          </label>

          {/* Office location */}
          <label className="block">
            <span className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-[color:var(--foreground)]">
              <MapPin size={13} strokeWidth={1.7} className="text-[color:var(--muted-foreground)]" />
              办公位置
            </span>
            <input type="text" value={officeLocation} onChange={(e) => setOfficeLocation(e.target.value)}
              placeholder="如：12楼1205室" className="neu-input w-full" />
          </label>

          {/* Department — full width on both columns */}
          <label className="sm:col-span-2 block">
            <span className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-[color:var(--foreground)]">
              <Building2 size={13} strokeWidth={1.7} className="text-[color:var(--muted-foreground)]" />
              部门
            </span>
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="neu-select w-full max-w-md">
              <option value="">未设置</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>{dept.name}</option>
              ))}
            </select>
          </label>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mt-5 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm"
            style={{ backgroundColor: 'rgba(255,241,241,0.76)', borderColor: 'rgba(215,89,89,0.18)', color: 'var(--danger)' }}
          >
            <AlertTriangle size={14} strokeWidth={1.6} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}
        {success && (
          <div className="mt-5 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm"
            style={{ backgroundColor: 'rgba(240,250,245,0.76)', borderColor: 'rgba(92,181,150,0.18)', color: 'var(--success)' }}
          >
            <Check size={14} strokeWidth={1.6} className="mt-0.5 shrink-0" />
            {success}
          </div>
        )}

        <hr className="wb-section-rule" />

        <div className="flex justify-center">
          <button type="button" onClick={handleSave} disabled={saving || !hasChanges}
            className="neu-btn-primary">
            {saving ? <><Loader2 size={16} className="animate-spin" />保存中...</> : '保存修改'}
          </button>
        </div>
      </div>
    </div>
  );
}
