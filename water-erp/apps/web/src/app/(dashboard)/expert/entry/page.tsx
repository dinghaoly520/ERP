'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createExpert, listSpecialties } from '@/lib/api/expert';
import { PageHero, SectionCard } from '@/components/workbench';
import { useFormAutosave, useUnsavedGuard } from '@/lib/hooks/use-form-autosave';
import { UserPlus, ArrowLeft, Eye, EyeOff, RotateCcw } from 'lucide-react';

const TITLES = ['教授级高级工程师','高级工程师','高级经济师','高级会计师','工程师','注册造价工程师','注册监理工程师'];

type FormFields = {
  username: string; displayName: string; password: string; specialty: string;
  title: string; employer: string; phone: string; idNumber: string; email: string; notes: string;
};

const INITIAL: FormFields = {
  username: '', displayName: '', password: '', specialty: '',
  title: '', employer: '', phone: '', idNumber: '', email: '', notes: '',
};

export default function ExpertEntryPage() {
  const router = useRouter();
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [form, setForm] = useState<FormFields>(INITIAL);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormFields, string>>>({});

  // ── 表单草稿 ──
  const hasChanges = Object.values(form).some(v => v !== '');
  const { getDraft, clearDraft } = useFormAutosave('expert-entry', form as unknown as Record<string, unknown>);
  useUnsavedGuard(hasChanges);
  const [draftRestored, setDraftRestored] = useState(false);
  useEffect(() => {
    if (draftRestored) return;
    const draft = getDraft();
    if (draft && draft.username) {
      const restore = confirm('检测到未提交的表单草稿（保存于 ' + new Date(draft._savedAt).toLocaleTimeString('zh-CN') + '），是否恢复？');
      if (restore) { setForm({ ...INITIAL, ...draft as unknown as FormFields }); }
    }
    setDraftRestored(true);
  }, [getDraft, draftRestored]);

  useEffect(() => { listSpecialties().then(setSpecialties).catch(() => {}); }, []);

  const set = (k: keyof FormFields, v: string) => {
    setForm(prev => ({ ...prev, [k]: v }));
    if (errors[k]) setErrors(prev => { const n = { ...prev }; delete n[k]; return n; });
    if (serverError) setServerError('');
  };

  const validate = (): boolean => {
    const e: Partial<Record<keyof FormFields, string>> = {};
    if (!form.username.trim()) e.username = '请输入登录账号';
    if (!form.displayName.trim()) e.displayName = '请输入专家姓名';
    if (!form.password.trim()) e.password = '请输入初始密码';
    else if (form.password.length < 6) e.password = '密码至少 6 位';
    if (!form.specialty.trim()) e.specialty = '请选择或输入专业领域';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    setServerError('');
    if (!validate()) return;
    setSaving(true);
    try {
      await createExpert(form);
      toast.success('专家录入成功');
      clearDraft();
      router.push('/expert/repository');
    } catch (e: any) { setServerError(e?.message || '录入失败，账号可能已存在'); }
    setSaving(false);
  };

  const input = (field: keyof FormFields) =>
    `workbench-input w-full text-sm ${errors[field] ? 'border-red-300 focus:border-red-400' : ''}`;

  const FieldError = ({ field }: { field: keyof FormFields }) =>
    errors[field] ? <p className="text-xs font-medium text-red-600 mt-0.5">{errors[field]}</p> : null;

  return (
    <div className="space-y-6">
      <PageHero
         title="专家录入"
        description="录入评审专家基础资料、专业方向和可用状态。录入后专家即可参与项目评审抽取。"
        tone="blue" icon={<UserPlus size={14} />}
      />

      {serverError && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          <span className="mt-px shrink-0 rounded-full bg-red-200 w-4 h-4 flex items-center justify-center text-[10px] font-extrabold text-red-700">!</span>
          <span>{serverError}</span>
        </div>
      )}

      <SectionCard title="专家资料" action={
        <button onClick={() => router.push('/expert/repository')} className="inline-flex items-center gap-1 rounded-xl border border-[#dce3eb] px-3 py-1.5 text-xs font-bold text-[#5a6d8a] hover:bg-[#f8fafc] transition">
          <ArrowLeft size={13} />返回专家库
        </button>
      }>
        <div className="space-y-6">
          {/* ──────────── 登录凭证 ──────────── */}
          <fieldset>
            <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.15em] text-[#94a3b8]">
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-md bg-[#064ea2] text-[10px] font-extrabold text-white">1</span>
              登录凭证
            </legend>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <label className="space-y-1">
                <span className="text-sm font-semibold text-[#5a6d8a]">登录账号 <span className="text-red-500">*</span></span>
                <input value={form.username} onChange={e => set('username', e.target.value)}
                  placeholder="如 expert_zhang" className={input('username')} autoComplete="off" />
                <FieldError field="username" />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-semibold text-[#5a6d8a]">专家姓名 <span className="text-red-500">*</span></span>
                <input value={form.displayName} onChange={e => set('displayName', e.target.value)}
                  placeholder="真实姓名" className={input('displayName')} />
                <FieldError field="displayName" />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-semibold text-[#5a6d8a]">初始密码 <span className="text-red-500">*</span></span>
                <div className="relative">
                  <input value={form.password} onChange={e => set('password', e.target.value)}
                    type={showPw ? 'text' : 'password'} placeholder="至少 6 位" className={input('password')} />
                  <button type="button" onClick={() => setShowPw(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#5a6d8a] transition-colors">
                    {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {!errors.password && <p className="text-xs text-[#94a3b8]">专家首次登录时使用，建议包含字母和数字</p>}
                <FieldError field="password" />
              </label>
            </div>
          </fieldset>

          <div className="border-t border-[#edf2f7]" />

          {/* ──────────── 专业资质 ──────────── */}
          <fieldset>
            <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.15em] text-[#94a3b8]">
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-md bg-[#064ea2] text-[10px] font-extrabold text-white">2</span>
              专业资质
            </legend>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <label className="space-y-1">
                <span className="text-sm font-semibold text-[#5a6d8a]">专业领域 <span className="text-red-500">*</span></span>
                <input value={form.specialty} onChange={e => set('specialty', e.target.value)}
                  list="spec-list" placeholder="如 水利工程" className={input('specialty')} />
                <datalist id="spec-list">{specialties.map(s => <option key={s} value={s} />)}</datalist>
                <FieldError field="specialty" />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-semibold text-[#5a6d8a]">职称</span>
                <input value={form.title} onChange={e => set('title', e.target.value)}
                  list="title-list" placeholder="如 高级工程师" className={input('title')} />
                <datalist id="title-list">{TITLES.map(t => <option key={t} value={t} />)}</datalist>
              </label>
              <label className="space-y-1">
                <span className="text-sm font-semibold text-[#5a6d8a]">工作单位</span>
                <input value={form.employer} onChange={e => set('employer', e.target.value)}
                  placeholder="用于供应商回避校验" className={input('employer')} />
                <p className="text-xs text-[#94a3b8]">填写全称，抽取时会按单位规避同单位专家</p>
              </label>
            </div>
          </fieldset>

          <div className="border-t border-[#edf2f7]" />

          {/* ──────────── 联系信息 ──────────── */}
          <fieldset>
            <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.15em] text-[#94a3b8]">
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-md border border-[#dce3eb] bg-[#f8fafc] text-[10px] font-extrabold text-[#5a6d8a]">3</span>
              联系信息
            </legend>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-sm font-semibold text-[#5a6d8a]">联系电话</span>
                <input value={form.phone} onChange={e => set('phone', e.target.value)}
                  type="tel" className={input('phone')} />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-semibold text-[#5a6d8a]">电子邮箱</span>
                <input value={form.email} onChange={e => set('email', e.target.value)}
                  type="email" placeholder="example@domain.com" className={input('email')} />
              </label>
              <label className="space-y-1 md:col-span-2">
                <span className="text-sm font-semibold text-[#5a6d8a]">身份证号</span>
                <input value={form.idNumber} onChange={e => set('idNumber', e.target.value)}
                  className={`${input('idNumber')} font-mono`} />
              </label>
            </div>
          </fieldset>

          <div className="border-t border-[#edf2f7]" />

          {/* ──────────── 补充信息 ──────────── */}
          <fieldset>
            <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.15em] text-[#94a3b8]">
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-md border border-[#dce3eb] bg-[#f8fafc] text-[10px] font-extrabold text-[#5a6d8a]">4</span>
              补充信息
            </legend>
            <label className="space-y-1">
              <span className="text-sm font-semibold text-[#5a6d8a]">备注</span>
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
                placeholder="补充说明、特殊资质说明、回避事项等"
                rows={3} className={`${input('notes')} resize-y`} />
            </label>
          </fieldset>

          {/* ──────────── 操作 ──────────── */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-t border-[#edf2f7] pt-5">
            <p className="text-xs text-[#94a3b8]">
              <span className="text-red-500">*</span> 为必填项，录入后可在专家库调整启停状态
            </p>
            <div className="flex gap-3 self-end sm:self-auto">
              <button onClick={() => router.push('/expert/repository')}
                className="rounded-xl border border-[#dce3eb] px-5 py-2.5 text-sm font-bold text-[#5a6d8a] hover:bg-[#f8fafc] transition">
                取消
              </button>
              <button onClick={submit} disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#064ea2] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#054280] disabled:opacity-50 transition">
                {saving ? '保存中...' : <><UserPlus size={14} />录入专家</>}
              </button>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
