'use client';

import {
  Loader2, Mail, Phone, MapPin, Building2, UserRound, Building,
  AlertTriangle, Check, Camera, Upload, KeyRound, Clock, Eye, EyeOff, X,
} from 'lucide-react';
import { useState, useRef, useEffect, useMemo } from 'react';
import { submitProfileChange, requestPasswordChange } from '@/lib/api/auth';
import type { AuthUser, DepartmentItem, ProfileChangePayload } from '@/lib/api/auth';
import { api } from '@/lib/api';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function daysAgo(iso: string): number {
  try { return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000); }
  catch { return 0; }
}

function getPasswordStrength(pwd: string): { score: number; label: string; color: string } {
  if (!pwd) return { score: 0, label: '未输入', color: 'var(--muted-foreground)' };
  let score = 0;
  if (pwd.length >= 8) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[a-z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  if (score <= 2) return { score, label: '弱', color: 'var(--danger)' };
  if (score <= 3) return { score, label: '中等', color: '#d4a017' };
  return { score, label: '强', color: 'var(--success)' };
}

const STRENGTH_CHECKS = [
  { key: 'length', label: '至少8位', test: (p: string) => p.length >= 8 },
  { key: 'upper', label: '大写字母', test: (p: string) => /[A-Z]/.test(p) },
  { key: 'lower', label: '小写字母', test: (p: string) => /[a-z]/.test(p) },
  { key: 'digit', label: '数字', test: (p: string) => /[0-9]/.test(p) },
  { key: 'special', label: '特殊字符', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

interface OperationLogItem { id: string; statusCode: number; ipAddress: string | null; userAgent: string | null; createdAt: string; }

interface TabBasicInfoProps {
  user: AuthUser;
  departments: DepartmentItem[];
}

export function TabBasicInfo({ user, departments }: TabBasicInfoProps) {
  // 资料编辑
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email ?? '');
  const [phone, setPhone] = useState(user.phone ?? '');
  const [officeLocation, setOfficeLocation] = useState(user.officeLocation ?? '');
  const [company, setCompany] = useState(user.company ?? '');
  const [departmentId, setDepartmentId] = useState(user.department?.id ?? '');
  const [avatar, setAvatar] = useState(user.avatar ?? '');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 密码修改
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pwdSubmitting, setPwdSubmitting] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null);
  const [lastPasswordChangeAt, setLastPasswordChangeAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<{ items: OperationLogItem[] }>('/operation-log/my?path=/auth/password-change-requests&limit=1')
      .then(res => { if (!cancelled && res.items?.[0]) setLastPasswordChangeAt(res.items[0].createdAt); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const hasChanges = displayName !== user.displayName || email !== (user.email ?? '') ||
    phone !== (user.phone ?? '') || officeLocation !== (user.officeLocation ?? '') ||
    company !== (user.company ?? '') ||
    departmentId !== (user.department?.id ?? '') || avatar !== (user.avatar ?? '');

  // 所有资料修改一律提交审批，审批通过前当前资料保持不变
  const handleSave = async () => {
    setError(null); setSuccess(null);
    if (!displayName.trim()) { setError('姓名不能为空'); return; }
    if (displayName.trim().length > 32) { setError('姓名不能超过 32 个字符'); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('邮箱格式不正确'); return; }
    if (phone && !/^[\d\-+() ]{7,20}$/.test(phone)) { setError('手机号码格式不正确'); return; }
    setSaving(true);
    try {
      const payload: ProfileChangePayload = {};
      if (displayName !== user.displayName) payload.displayName = displayName.trim();
      if (email !== (user.email ?? '')) payload.email = email.trim() || null;
      if (phone !== (user.phone ?? '')) payload.phone = phone.trim() || null;
      if (officeLocation !== (user.officeLocation ?? '')) payload.officeLocation = officeLocation.trim() || null;
      if (company !== (user.company ?? '')) payload.company = company.trim() || null;
      if (departmentId !== (user.department?.id ?? '')) payload.departmentId = departmentId || null;
      if (avatar !== (user.avatar ?? '')) payload.avatar = avatar.trim() || null;
      await submitProfileChange(payload);
      // 未生效：表单回滚到当前资料，避免误以为已保存
      setDisplayName(user.displayName);
      setEmail(user.email ?? '');
      setPhone(user.phone ?? '');
      setOfficeLocation(user.officeLocation ?? '');
      setCompany(user.company ?? '');
      setDepartmentId(user.department?.id ?? '');
      setAvatar(user.avatar ?? '');
      setSuccess('资料变更申请已提交，等待管理员审批后生效'); setTimeout(() => setSuccess(null), 4000);
    } catch (err) { setError(err instanceof Error ? err.message : '提交失败'); }
    finally { setSaving(false); }
  };

  const handlePasswordSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setPwdError(null); setPwdSuccess(null);
    if (!currentPassword) { setPwdError('请输入当前密码'); return; }
    if (!newPassword) { setPwdError('请输入新密码'); return; }
    if (newPassword.length < 6) { setPwdError('新密码至少需要 6 位'); return; }
    if (newPassword !== confirmPassword) { setPwdError('两次输入的新密码不一致'); return; }
    setPwdSubmitting(true);
    try {
      await requestPasswordChange({ currentPassword, newPassword });
      setPwdSuccess('申请已提交，等待管理员审批通过后新密码才会生效。');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (err) { setPwdError(err instanceof Error ? err.message : '提交失败'); }
    finally { setPwdSubmitting(false); }
  };

  const pwdStrength = useMemo(() => getPasswordStrength(newPassword), [newPassword]);

  // 资料字段定义
  const profileFields = [
    { label: '姓名', icon: UserRound, val: displayName, set: setDisplayName, type: 'text', placeholder: '请输入姓名', maxLen: 32 },
    { label: '公司', icon: Building, val: company, set: setCompany, type: 'text', placeholder: '请输入所属公司', maxLen: 64 },
    { label: '部门', icon: Building2, val: departmentId, set: setDepartmentId, type: 'select', placeholder: '', options: departments },
    { label: '邮箱', icon: Mail, val: email, set: setEmail, type: 'email', placeholder: '请输入邮箱' },
    { label: '手机', icon: Phone, val: phone, set: setPhone, type: 'tel', placeholder: '请输入手机号' },
    { label: '办公位置', icon: MapPin, val: officeLocation, set: setOfficeLocation, type: 'text', placeholder: '如：12楼1205室' },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* ═══ 左栏：编辑资料 ═══ */}
      <div className="wb-panel flex flex-col p-5">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">
          <UserRound size={12} strokeWidth={1.8} className="text-[var(--accent)]" />编辑资料
        </h3>
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
          <Clock size={11} strokeWidth={1.6} />
          所有资料修改均需管理员审批后生效
        </div>

        {/* 头像 — 紧凑水平布局 */}
        <div className="mt-4 flex items-center gap-4">
          <div className="shrink-0">
            {avatar ? (
              <div className="h-[60px] w-[60px] overflow-hidden rounded-[14px]">
                <img src={avatar} alt="头像" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              </div>
            ) : (
              <div className="neu-icon-well flex h-[60px] w-[60px] items-center justify-center rounded-[14px]">
                <Camera size={22} className="text-[var(--muted-foreground)] opacity-40" />
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0]; if (!file) return;
              if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('仅支持 JPG/PNG/WebP'); return; }
              if (file.size > 2 * 1024 * 1024) { setError('头像不能超过 2MB'); return; }
              setAvatarUploading(true); setError(null);
              try { setAvatar(await fileToBase64(file)); } catch { setError('图片处理失败'); }
              finally { setAvatarUploading(false); }
            }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={avatarUploading} className="neu-btn-xs">
            {avatarUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            {avatar ? '更换' : '上传'}
          </button>
        </div>

        <hr className="wb-section-rule mt-4" />

        {/* 表单 — 紧凑水平 label-input 布局 */}
        <div className="flex flex-col">
          {profileFields.map((f: any, idx) => (
            <div key={f.label}>
              {idx > 0 && <hr className="wb-section-rule" />}
              <div className="flex items-center gap-3 py-2.5">
                <div className="flex w-[88px] shrink-0 items-center gap-1.5 text-[12px] font-semibold text-[var(--muted-foreground)]">
                  <f.icon size={12} strokeWidth={1.7} />{f.label}
                </div>
                {f.type === 'select' ? (
                  <select value={f.val} onChange={e => f.set(e.target.value)} className="workbench-input h-[36px] flex-1 text-[13px]">
                    <option value="">未设置</option>
                    {f.options.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                ) : (
                  <input type={f.type} value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.placeholder} maxLength={f.maxLen} className="neu-input h-[36px] flex-1 py-0 text-[13px]" />
                )}
              </div>
            </div>
          ))}
        </div>

        {/* 提示 + 保存按钮 */}
        {error && <div className="mt-3 rounded-lg px-3 py-2 text-[12px]" style={{ backgroundColor: 'oklch(0.6 0.18 25 / 0.06)', color: 'var(--danger)' }}><AlertTriangle size={12} className="mr-1.5 inline" />{error}</div>}
        {success && <div className="mt-3 rounded-lg px-3 py-2 text-[12px]" style={{ backgroundColor: 'oklch(0.7 0.15 155 / 0.08)', color: 'var(--success)' }}><Check size={12} className="mr-1.5 inline" />{success}</div>}

        <div className="mt-4 flex justify-end">
          <button type="button" onClick={handleSave} disabled={saving || !hasChanges} className="neu-btn-primary !h-[36px] !text-[13px]">
            {saving ? <><Loader2 size={14} className="animate-spin" />提交中</> : '提交审批'}
          </button>
        </div>
      </div>

      {/* ═══ 右栏：修改密码 ═══ */}
      <div className="wb-panel flex flex-col p-5">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">
          <KeyRound size={12} strokeWidth={1.8} className="text-[var(--accent)]" />修改密码
        </h3>

        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)]">
          <Clock size={11} strokeWidth={1.6} />
          上次修改：{lastPasswordChangeAt ? `${daysAgo(lastPasswordChangeAt)} 天前` : '暂无记录'}
          <span className="ml-2 text-[var(--muted-foreground)]/60">· 需管理员审批</span>
        </div>

        <hr className="wb-section-rule mt-3" />

        <form id="pwd-form" onSubmit={handlePasswordSubmit} noValidate className="mt-1 flex flex-col">
          {[
            { label: '当前密码', val: currentPassword, set: setCurrentPassword, show: showCurrent, toggle: setShowCurrent, placeholder: '请输入当前密码', auto: 'current-password' as const },
            { label: '新密码', val: newPassword, set: setNewPassword, show: showNew, toggle: setShowNew, placeholder: '不少于 6 位', auto: 'new-password' as const },
            { label: '确认密码', val: confirmPassword, set: setConfirmPassword, show: showConfirm, toggle: setShowConfirm, placeholder: '再次输入新密码', auto: 'new-password' as const },
          ].map((f, idx) => (
            <div key={f.label}>
              {idx > 0 && <hr className="wb-section-rule" />}
              <div className="flex items-center gap-3 py-2.5">
                <div className="flex w-[88px] shrink-0 items-center gap-1.5 text-[12px] font-semibold text-[var(--muted-foreground)]">
                  {f.label}
                </div>
                <div className="relative flex-1">
                  <input type={f.show ? 'text' : 'password'} value={f.val} onChange={e => f.set(e.target.value)} placeholder={f.placeholder} autoComplete={f.auto} className="neu-input h-[36px] w-full py-0 pr-9 text-[13px]" />
                  <button type="button" onClick={() => f.toggle(!f.show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--foreground)]" tabIndex={-1}>
                    {f.show ? <EyeOff size={13} strokeWidth={1.5} /> : <Eye size={13} strokeWidth={1.5} />}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </form>

        {/* 密码强度指示器 — 紧凑 */}
        {newPassword && (
          <div className="mt-2 rounded-lg p-3" style={{ backgroundColor: 'oklch(0.55 0.03 258 / 0.04)' }}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold text-[var(--foreground)]">强度</span>
              <span className="text-[11px] font-bold" style={{ color: pwdStrength.color }}>{pwdStrength.label}</span>
            </div>
            <div className="mb-2 flex gap-1">
              {[0,1,2,3,4].map(i => <div key={i} className="h-1 flex-1 rounded-full transition-colors duration-200" style={{ backgroundColor: i < pwdStrength.score ? pwdStrength.color : 'oklch(0.55 0.01 258 / 0.08)' }} />)}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
              {STRENGTH_CHECKS.map(c => {
                const passed = c.test(newPassword);
                return <span key={c.key} className="inline-flex items-center gap-1 text-[10px]" style={{ color: passed ? 'var(--success)' : 'var(--muted-foreground)' }}>{passed ? <Check size={9} strokeWidth={2.5} /> : <X size={9} strokeWidth={2} />}{c.label}</span>;
              })}
            </div>
          </div>
        )}

        {pwdError && <div className="mt-3 rounded-lg px-3 py-2 text-[12px]" style={{ backgroundColor: 'oklch(0.6 0.18 25 / 0.06)', color: 'var(--danger)' }}><AlertTriangle size={12} className="mr-1.5 inline" />{pwdError}</div>}
        {pwdSuccess && <div className="mt-3 rounded-lg px-3 py-2 text-[12px]" style={{ backgroundColor: 'oklch(0.7 0.15 155 / 0.08)', color: 'var(--success)' }}><Check size={12} className="mr-1.5 inline" />{pwdSuccess}</div>}

        <div className="mt-4 flex justify-end">
          {/* 与左栏「提交审批」一致：无内容（任一项未填）时置灰，避免点击后才报「请输入…」 */}
          <button type="submit" form="pwd-form" disabled={pwdSubmitting || !currentPassword || !newPassword || !confirmPassword} className="neu-btn-primary !h-[36px] !text-[13px]">
            {pwdSubmitting ? <><Loader2 size={14} className="animate-spin" />提交中</> : '提交审批'}
          </button>
        </div>
      </div>
    </div>
  );
}
