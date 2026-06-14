'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createExpert, listSpecialties } from '@/lib/api/expert';
import { ArrowLeft, UserPlus } from 'lucide-react';

const TITLES = ['教授级高级工程师', '高级工程师', '高级经济师', '高级会计师', '工程师', '注册造价工程师', '注册监理工程师'];

export default function ExpertEntryPage() {
  const router = useRouter();
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [form, setForm] = useState({
    username: '', displayName: '', password: '', specialty: '',
    title: '', employer: '', phone: '', idNumber: '', email: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { listSpecialties().then(setSpecialties).catch(() => {}); }, []);

  const set = (k: keyof typeof form, v: string) => setForm(prev => ({ ...prev, [k]: v }));

  const submit = async () => {
    setError('');
    if (!form.username.trim() || !form.displayName.trim() || !form.password.trim() || !form.specialty.trim()) {
      setError('请填写账号、姓名、初始密码和专业领域'); return;
    }
    if (form.password.length < 6) { setError('初始密码至少 6 位'); return; }
    setSaving(true);
    try {
      await createExpert(form);
      alert('专家录入成功');
      router.push('/expert/repository');
    } catch (e: any) { setError(e?.message || '录入失败，账号可能已存在'); }
    setSaving(false);
  };

  return (
    <div>
      {/* Header */}
      <button onClick={() => router.push('/expert/repository')} className="inline-flex items-center gap-1.5 text-[13px] text-[#5a6d8a] hover:text-[#0756a5] mb-4">
        <ArrowLeft size={14} /> 返回专家库
      </button>

      <div className="mb-6">
        <div className="text-[11px] font-extrabold text-[#0756a5] uppercase tracking-[0.1em]">Expert Management</div>
        <h1 className="mt-1 text-[22px] font-black tracking-[-0.03em] text-[#0f172a]">录入专家</h1>
        <p className="mt-1 text-[13px] text-[#64748b]">创建评审专家账号，录入基本信息后即可参与项目抽取与评审。</p>
      </div>

      {/* Form */}
      <div className="max-w-3xl border border-[#dce3eb] bg-white px-6 py-5">
        {error && (
          <div className="mb-5 px-4 py-2.5 border border-[#fca5a5] bg-[#fef2f2] text-[13px] text-[#991b1b]">{error}</div>
        )}

        <div className="grid grid-cols-2 gap-x-5 gap-y-4">
          <Field label="登录账号" required>
            <input value={form.username} onChange={e => set('username', e.target.value)} placeholder="如 expert_zhang" className={inputCls} />
          </Field>
          <Field label="专家姓名" required>
            <input value={form.displayName} onChange={e => set('displayName', e.target.value)} placeholder="姓名" className={inputCls} />
          </Field>
          <Field label="初始密码" required>
            <input value={form.password} onChange={e => set('password', e.target.value)} placeholder="至少 6 位" type="password" className={inputCls} />
          </Field>
          <Field label="专业领域" required>
            <input value={form.specialty} onChange={e => set('specialty', e.target.value)} list="spec-list" placeholder="如 水利工程" className={inputCls} />
            <datalist id="spec-list">{specialties.map(s => <option key={s} value={s} />)}</datalist>
          </Field>
          <Field label="职称">
            <input value={form.title} onChange={e => set('title', e.target.value)} list="title-list" placeholder="如 高级工程师" className={inputCls} />
            <datalist id="title-list">{TITLES.map(t => <option key={t} value={t} />)}</datalist>
          </Field>
          <Field label="工作单位">
            <input value={form.employer} onChange={e => set('employer', e.target.value)} placeholder="用于供应商回避校验" className={inputCls} />
          </Field>
          <Field label="联系电话">
            <input value={form.phone} onChange={e => set('phone', e.target.value)} className={inputCls} />
          </Field>
          <Field label="身份证号">
            <input value={form.idNumber} onChange={e => set('idNumber', e.target.value)} className={inputCls} />
          </Field>
          <Field label="邮箱">
            <input value={form.email} onChange={e => set('email', e.target.value)} className={inputCls} />
          </Field>
          <Field label="备注" full>
            <input value={form.notes} onChange={e => set('notes', e.target.value)} className={inputCls} />
          </Field>
        </div>

        <div className="flex justify-end gap-3 mt-7 pt-4 border-t border-[#e9eef4]">
          <button onClick={() => router.push('/expert/repository')} className="px-5 py-2 text-[13px] font-semibold text-[#64748b] hover:bg-[#f8fafc] border border-[#dce3eb] transition">取消</button>
          <button onClick={submit} disabled={saving} className="inline-flex items-center gap-1.5 px-5 py-2 text-[13px] font-bold text-white bg-[#0756a5] hover:bg-[#06428a] disabled:opacity-50 transition">
            <UserPlus size={14} />{saving ? '保存中...' : '录入专家'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full px-3 py-2 border border-[#dce3eb] text-[13px] placeholder:text-[#94a3b8] focus:outline-none focus:border-[#0756a5] focus:ring-0';

function Field({ label, children, full, required }: { label: string; children: React.ReactNode; full?: boolean; required?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label className="block text-[12px] font-semibold text-[#475569] mb-1.5">
        {label}{required && <span className="text-[#dc2626] ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
