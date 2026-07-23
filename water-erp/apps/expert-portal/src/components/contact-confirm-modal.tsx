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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0f172a]/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-[#dbe6f3] bg-white shadow-2xl">
        <div className="border-b border-[#eef3fa] p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[#064ea2]/10 text-[#064ea2]">
              <ShieldCheck size={22} strokeWidth={1.5} />
            </span>
            <div>
              <h3 className="text-lg font-black text-[#18243a]">确认联系方式</h3>
              <p className="text-sm text-[#5a6d8a]">{displayName}，请确认以下信息，确保我们能联系到您</p>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-6">
          <div>
            <label className="mb-1.5 block text-sm font-bold text-[#18243a]">
              手机号 <span className="text-[#e74c3c]">*</span>
            </label>
            <div className="relative">
              <Phone size={16} strokeWidth={1.5} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8a96aa]" />
              <input
                value={phone}
                onChange={e => { setPhone(e.target.value); setPhoneError(''); }}
                maxLength={11}
                placeholder="请输入11位手机号"
                className="w-full rounded-xl border border-[#e5ecf4] py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-[#064ea2] focus:shadow-[0_0_0_3px_rgba(6,78,162,0.10)]"
              />
            </div>
            {phoneError && <p className="mt-1 text-xs text-[#e74c3c]">{phoneError}</p>}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-bold text-[#18243a]">邮箱（选填）</label>
            <div className="relative">
              <Mail size={16} strokeWidth={1.5} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8a96aa]" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="用于接收通知（可留空）"
                className="w-full rounded-xl border border-[#e5ecf4] py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-[#064ea2] focus:shadow-[0_0_0_3px_rgba(6,78,162,0.10)]"
              />
            </div>
          </div>
        </div>

        <div className="border-t border-[#eef3fa] p-6 pt-4">
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="w-full rounded-xl bg-[#064ea2] py-2.5 text-sm font-bold text-white transition hover:bg-[#054280] disabled:opacity-50"
          >
            {saving ? '确认中...' : '确认联系方式'}
          </button>
          <p className="mt-3 text-center text-xs text-[#8a96aa]">确认后将用于评审通知与身份核验</p>
        </div>
      </div>
    </div>
  );
}
