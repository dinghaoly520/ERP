'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createExpert, listSpecialties } from '@/lib/api/expert';
import { useEffect } from 'react';

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
      <div className="mb-6">
        <div className="mb-2 inline-flex rounded-full border border-[#ddd6fe] bg-[#f5f3ff] px-3 py-1 text-xs font-semibold text-[#7c3aed]">专家管理中心</div>
        <h1 className="text-2xl font-bold text-[#0f2f57]">专家录入</h1>
        <p className="text-sm text-[#5a6d8a] mt-1">录入评审专家基本信息与专业领域，纳入专家库</p>
      </div>

      <div className="bg-white rounded-2xl border border-[#e5ecf4] p-6 max-w-3xl">
        {error && <div className="mb-4 rounded-lg border border-[#fca5a5] bg-[#fef2f2] px-4 py-2.5 text-sm text-[#c0392b]">{error}</div>}

        <div className="grid grid-cols-2 gap-4">
          <Field label="登录账号 *">
            <input value={form.username} onChange={e => set('username', e.target.value)} placeholder="如 expert_zhang" className={inputCls} />
          </Field>
          <Field label="专家姓名 *">
            <input value={form.displayName} onChange={e => set('displayName', e.target.value)} placeholder="姓名" className={inputCls} />
          </Field>
          <Field label="初始密码 *">
            <input value={form.password} onChange={e => set('password', e.target.value)} placeholder="至少 6 位" className={inputCls} />
          </Field>
          <Field label="专业领域 *">
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

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => router.push('/expert/repository')} className="px-5 py-2 text-sm text-[#5a6d8a] hover:bg-[#f8fafc] rounded-lg transition">取消</button>
          <button onClick={submit} disabled={saving} className="px-5 py-2 text-sm text-white bg-[#7c3aed] hover:bg-[#6d28d9] rounded-lg disabled:opacity-50 transition">{saving ? '保存中...' : '录入专家'}</button>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'w-full px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#7c3aed]';
function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label className="block text-xs font-semibold text-[#5a6d8a] mb-1.5">{label}</label>
      {children}
    </div>
  );
}
