'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createExpert, listSpecialties } from '@/lib/api/expert';
import { useFormAutosave, useUnsavedGuard } from '@/lib/hooks/use-form-autosave';
import { UserPlus, Eye, EyeOff } from 'lucide-react';

const TITLES = ['教授级高级工程师','高级工程师','高级经济师','高级会计师','工程师','注册造价工程师','注册监理工程师'];
const EDUCATIONS = ['博士','硕士','本科','大专','其他'];
const ETHNICITIES = ['汉族','蒙古族','回族','藏族','维吾尔族','苗族','彝族','壮族','布依族','朝鲜族','满族','侗族','瑶族','白族','土家族','其他'];

type FormFields = { username: string; displayName: string; password: string; specialty: string; title: string; employer: string; phone: string; idNumber: string; email: string; notes: string; ethnicity: string; education: string; licenseNo: string; };
const INITIAL: FormFields = { username: '', displayName: '', password: '', specialty: '', title: '', employer: '', phone: '', idNumber: '', email: '', notes: '', ethnicity: '', education: '', licenseNo: '' };

export default function ExpertEntryPage() {
  const router = useRouter();
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [form, setForm] = useState<FormFields>(INITIAL);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormFields, string>>>({});
  const hasChanges = Object.values(form).some(v => v !== '');
  const { getDraft, clearDraft } = useFormAutosave('expert-entry', form as unknown as Record<string, unknown>);
  useUnsavedGuard(hasChanges);
  const [draftRestored, setDraftRestored] = useState(false);
  useEffect(() => {
    if (draftRestored) return;
    const draft = getDraft();
    if (draft && draft.username) { if (confirm('检测到未提交的表单草稿（保存于 ' + new Date(draft._savedAt).toLocaleTimeString('zh-CN') + '），是否恢复？')) { setForm({ ...INITIAL, ...draft as unknown as FormFields }); } }
    setDraftRestored(true);
  }, [getDraft, draftRestored]);
  useEffect(() => { listSpecialties().then(setSpecialties).catch(() => {}); }, []);

  const set = (k: keyof FormFields, v: string) => { setForm(prev => ({ ...prev, [k]: v })); if (errors[k]) setErrors(prev => { const n = { ...prev }; delete n[k]; return n; }); if (serverError) setServerError(''); };
  const validate = (): boolean => {
    const e: Partial<Record<keyof FormFields, string>> = {};
    if (!form.username.trim()) e.username = '请输入登录账号';
    if (!form.displayName.trim()) e.displayName = '请输入专家姓名';
    if (!form.password.trim()) e.password = '请输入初始密码';
    else if (form.password.length < 6) e.password = '密码至少 6 位';
    if (!form.specialty.trim()) e.specialty = '请选择或输入专业领域';
    if (form.phone.trim() && !validatePhone(form.phone)) e.phone = '手机号格式不正确（11位数字）';
    if (form.idNumber.trim() && !validateIdNumber(form.idNumber)) e.idNumber = '身份证号格式不正确（18位）';
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const submit = async () => { setServerError(''); if (!validate()) return; setSaving(true); try { await createExpert(form); toast.success('专家录入成功'); clearDraft(); router.push('/expert/repository'); } catch (e: any) { setServerError(e?.message || '录入失败'); } setSaving(false); };
  const validatePhone = (v: string) => /^1[3-9]\d{9}$/.test(v.trim());
  const validateIdNumber = (v: string) => /^\d{17}[\dXx]$/.test(v.trim());

  const inputCls = (field: keyof FormFields) => `neu-input w-full text-sm ${errors[field] ? '!border-[var(--danger)]' : ''}`;
  const FieldError = ({ field }: { field: keyof FormFields }) => errors[field] ? <p className="text-xs font-medium text-[var(--danger)] mt-0.5">{errors[field]}</p> : null;
  const Step = ({ n }: { n: number }) => <span className="flex h-[18px] w-[18px] items-center justify-center rounded-md text-[10px] font-extrabold bg-[var(--accent)] text-white">{n}</span>;

  return (
    <div className="flex flex-col gap-5">
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><UserPlus size={17} /></div>
            <div><div className="page-hero__title">专家录入</div><div className="page-hero__sub">录入评审专家基础资料、专业方向和可用状态，录入后专家即可参与项目评审抽取</div></div>
          </div>
          <div className="page-hero__right">
            <button onClick={() => router.push('/expert/repository')} className="neu-btn-soft">返回专家库</button>
          </div>
        </div>
      </div>

      {serverError && (
        <div className="rounded-xl bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-4 py-3 text-sm font-semibold text-[var(--danger)] shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">{serverError}</div>
      )}

      <div className="neu-table-card p-5 space-y-6">
        {/* ① 登录凭证 */}
        <fieldset>
          <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]"><Step n={1} />登录凭证</legend>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">登录账号 <span className="text-[var(--danger)]">*</span></span><input value={form.username} onChange={e => set('username', e.target.value)} placeholder="如 expert_zhang" className={inputCls('username')} /><FieldError field="username" /></label>
            <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">专家姓名 <span className="text-[var(--danger)]">*</span></span><input value={form.displayName} onChange={e => set('displayName', e.target.value)} placeholder="真实姓名" className={inputCls('displayName')} /><FieldError field="displayName" /></label>
            <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">初始密码 <span className="text-[var(--danger)]">*</span></span><div className="relative"><input value={form.password} onChange={e => set('password', e.target.value)} type={showPw ? 'text' : 'password'} placeholder="至少 6 位" className={inputCls('password')} /><button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--foreground)]">{showPw ? <EyeOff size={15} /> : <Eye size={15} />}</button></div><FieldError field="password" /></label>
          </div>
        </fieldset>
        <hr className="wb-section-rule" />

        {/* ② 专业资质 */}
        <fieldset>
          <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]"><Step n={2} />专业资质</legend>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">专业领域 <span className="text-[var(--danger)]">*</span></span><input value={form.specialty} onChange={e => set('specialty', e.target.value)} list="spec-list" placeholder="如 水利工程" className={inputCls('specialty')} /><datalist id="spec-list">{specialties.map(s => <option key={s} value={s} />)}</datalist><FieldError field="specialty" /></label>
            <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">职称</span><input value={form.title} onChange={e => set('title', e.target.value)} list="title-list" placeholder="如 高级工程师" className={inputCls('title')} /><datalist id="title-list">{TITLES.map(t => <option key={t} value={t} />)}</datalist></label>
            <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">工作单位</span><input value={form.employer} onChange={e => set('employer', e.target.value)} placeholder="用于供应商回避校验" className={inputCls('employer')} /></label>
          </div>
        </fieldset>
        <hr className="wb-section-rule" />

        {/* ③ 联系信息 */}
        <fieldset>
          <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]"><Step n={3} />联系信息</legend>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">联系电话</span><input value={form.phone} onChange={e => set('phone', e.target.value)} className={inputCls('phone')} /></label>
            <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">电子邮箱</span><input value={form.email} onChange={e => set('email', e.target.value)} placeholder="example@domain.com" className={inputCls('email')} /></label>
            <label className="space-y-1 md:col-span-2"><span className="text-xs font-semibold text-[var(--muted-foreground)]">身份证号</span><input value={form.idNumber} onChange={e => set('idNumber', e.target.value)} className={inputCls('idNumber') + ' font-mono'} /></label>
          </div>
        </fieldset>
        <hr className="wb-section-rule" />

        {/* ④ 档案信息 */}
        <fieldset>
          <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]"><Step n={4} />档案信息</legend>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">民族</span><input value={form.ethnicity} onChange={e => set('ethnicity', e.target.value)} list="ethnicity-list" placeholder="如 汉族" className={inputCls('ethnicity')} /><datalist id="ethnicity-list">{ETHNICITIES.map(t => <option key={t} value={t} />)}</datalist></label>
            <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">学历</span><input value={form.education} onChange={e => set('education', e.target.value)} list="edu-list" placeholder="如 硕士" className={inputCls('education')} /><datalist id="edu-list">{EDUCATIONS.map(t => <option key={t} value={t} />)}</datalist></label>
            <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">执业资格证号</span><input value={form.licenseNo} onChange={e => set('licenseNo', e.target.value)} placeholder="执业资格证号" className={inputCls('licenseNo') + ' font-mono'} /></label>
          </div>
        </fieldset>
        <hr className="wb-section-rule" />

        {/* ⑤ 补充信息 */}
        <fieldset>
          <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]"><Step n={5} />补充信息</legend>
          <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">备注</span><textarea value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="补充说明、特殊资质说明、回避事项等" rows={3} className={inputCls('notes') + ' resize-y'} /></label>
        </fieldset>

        <div className="flex items-center justify-between gap-3 pt-4" style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
          <p className="text-xs text-[var(--muted-foreground)]"><span className="text-[var(--danger)]">*</span> 为必填项</p>
          <div className="flex gap-3">
            <button onClick={() => router.push('/expert/repository')} className="neu-btn-soft">取消</button>
            <button onClick={submit} disabled={saving} className="neu-btn-soft is-info">{saving ? '保存中...' : <><UserPlus size={14} />录入专家</>}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
