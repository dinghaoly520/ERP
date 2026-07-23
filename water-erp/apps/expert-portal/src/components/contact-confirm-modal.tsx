'use client';

import { useState } from 'react';
import { Phone, Mail, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from 'sonner';

interface ContactConfirmModalProps {
  initialPhone: string;
  initialEmail: string;
  displayName: string;
  onConfirmed: () => void;
}

export default function ContactConfirmModal({ initialPhone, initialEmail, displayName, onConfirmed }: ContactConfirmModalProps) {
  const [phone, setPhone] = useState(initialPhone);
  const [email, setEmail] = useState(initialEmail);
  const [saving, setSaving] = useState(false);
  const [phoneError, setPhoneError] = useState('');

  const handleConfirm = async () => {
    const trimmedPhone = phone.trim();
    if (!/^1[3-9]\d{9}$/.test(trimmedPhone)) {
      setPhoneError('请输入正确的11位手机号');
      return;
    }
    setPhoneError('');
    setSaving(true);
    try {
      const body: { phone: string; email?: string } = { phone: trimmedPhone };
      const trimmedEmail = email.trim();
      if (trimmedEmail) body.email = trimmedEmail;
      await api.post('/expert/profile/confirm-contact', body);
      toast.success('联系方式已确认');
      onConfirmed();
    } catch {
      toast.error('确认失败，请重试');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--background)]/60 p-4 backdrop-blur-sm">
      <div className="exp-dialog w-full max-w-md">
        <div className="p-6">
          <div className="flex items-center gap-3">
            <span className="page-hero__icon !h-11 !w-11 !rounded-xl">
              <ShieldCheck size={22} strokeWidth={1.5} />
            </span>
            <div>
              <h3 className="text-lg font-bold text-[var(--foreground)]">确认联系方式</h3>
              <p className="text-sm text-[var(--muted-foreground)]">{displayName}，请确认以下信息，确保我们能联系到您</p>
            </div>
          </div>
        </div>

        <div className="space-y-4 px-6 pb-2">
          <div>
            <label className="mb-1.5 block text-sm font-bold text-[var(--foreground)]">
              手机号 <span className="text-[var(--danger)]">*</span>
            </label>
            <div className="relative">
              <Phone size={16} strokeWidth={1.5} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <input
                value={phone}
                onChange={e => { setPhone(e.target.value); setPhoneError(''); }}
                maxLength={11}
                placeholder="请输入11位手机号"
                className="neu-input has-icon"
                aria-invalid={phoneError ? 'true' : undefined}
              />
            </div>
            {phoneError && <p className="mt-1.5 text-xs font-semibold text-[var(--danger)]">{phoneError}</p>}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-bold text-[var(--foreground)]">邮箱（选填）</label>
            <div className="relative">
              <Mail size={16} strokeWidth={1.5} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="用于接收通知（可留空）"
                className="neu-input has-icon"
              />
            </div>
          </div>
        </div>

        <hr className="wb-section-rule !mx-6" />
        <div className="p-6 pt-4">
          <button onClick={handleConfirm} disabled={saving} className="neu-btn-primary !h-11 w-full">
            {saving ? '确认中...' : '确认联系方式'}
          </button>
          <p className="mt-3 text-center text-xs text-[var(--muted-foreground)]">确认后将用于评审通知与身份核验</p>
        </div>
      </div>
    </div>
  );
}
