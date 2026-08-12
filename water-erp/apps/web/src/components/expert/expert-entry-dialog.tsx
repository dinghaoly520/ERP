'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { createExpert, listSpecialties, ocrIntake } from '@/lib/api/expert';
import { Modal } from '@/components/workbench';
import { ExpertCsvActions } from './expert-csv-actions';
import { UserPlus, Eye, EyeOff, ScanLine, RefreshCw } from 'lucide-react';

const TITLES = ['教授级高级工程师','高级工程师','高级经济师','高级会计师','工程师','注册造价工程师','注册监理工程师'];
const EDUCATIONS = ['博士','硕士','本科','大专','其他'];
const ETHNICITIES = ['汉族','蒙古族','回族','藏族','维吾尔族','苗族','彝族','壮族','布依族','朝鲜族','满族','侗族','瑶族','白族','土家族','其他'];

type FormFields = { username: string; displayName: string; password: string; specialty: string; title: string; employer: string; departmentName: string; phone: string; idNumber: string; email: string; notes: string; ethnicity: string; education: string; licenseNo: string; };
const INITIAL: FormFields = { username: '', displayName: '', password: '', specialty: '', title: '', employer: '', departmentName: '', phone: '', idNumber: '', email: '', notes: '', ethnicity: '', education: '', licenseNo: '' };

interface ExpertEntryDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
}

export function ExpertEntryDialog({ open, onClose, onSubmitted }: ExpertEntryDialogProps) {
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [form, setForm] = useState<FormFields>(INITIAL);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormFields, string>>>({});

  useEffect(() => {
    if (open) {
      listSpecialties().then(setSpecialties).catch(() => toast.warning('加载专业列表失败，可手动输入'));
      // 重置表单
      setForm(INITIAL);
      setErrors({});
      setServerError('');
    }
  }, [open]);

  const set = (k: keyof FormFields, v: string) => {
    setForm(prev => ({ ...prev, [k]: v }));
    if (errors[k]) setErrors(prev => { const n = { ...prev }; delete n[k]; return n; });
    if (serverError) setServerError('');
  };

  const validatePhone = (v: string) => /^1[3-9]\d{9}$/.test(v.trim());
  const validateIdNumber = (v: string) => /^\d{17}[\dXx]$/.test(v.trim());
  const validateEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

  const validate = (): boolean => {
    const e: Partial<Record<keyof FormFields, string>> = {};
    if (!form.username.trim()) e.username = '请输入登录账号';
    if (!form.displayName.trim()) e.displayName = '请输入专家姓名';
    if (!form.password.trim()) e.password = '请输入初始密码';
    else if (form.password.length < 6) e.password = '密码至少 6 位';
    if (!form.specialty.trim()) e.specialty = '请选择或输入专业领域';
    if (form.phone.trim() && !validatePhone(form.phone)) e.phone = '手机号格式不正确（11位数字）';
    if (form.idNumber.trim() && !validateIdNumber(form.idNumber)) e.idNumber = '身份证号格式不正确（18位）';
    if (form.email.trim() && !validateEmail(form.email)) e.email = '邮箱格式不正确';
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
      onSubmitted?.();
      onClose();
    } catch (e: any) {
      setServerError(e?.message || '录入失败');
    }
    setSaving(false);
  };

  const handleOcr = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') { toast.error('请选择图片文件或 PDF（证件/证书扫描件）'); e.target.value = ''; return; }
    const maxSize = file.type === 'application/pdf' ? 10 * 1024 * 1024 : 4 * 1024 * 1024;
    if (file.size > maxSize) { toast.error(`文件过大，请压缩至 ${maxSize / 1024 / 1024}MB 以内后再识别`); e.target.value = ''; return; }
    setOcrLoading(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const { fields } = await ocrIntake({ imageBase64: base64, mimeType: file.type, filename: file.name });
      const map: Partial<FormFields> = {};
      (['displayName', 'specialty', 'title', 'employer', 'idNumber', 'phone', 'licenseNo', 'education', 'ethnicity'] as (keyof FormFields)[]).forEach(k => {
        const v = fields[k];
        if (v && String(v).trim()) map[k] = String(v).trim();
      });
      const filled = Object.keys(map).length;
      if (filled === 0) toast.warning('未识别到有效字段，请手动填写');
      else { setForm(prev => ({ ...prev, ...map })); toast.success(`已识别并填充 ${filled} 个字段，请核对后保存`); }
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('OCR 服务不可用') || msg.includes('OCR_UNAVAILABLE')) {
        toast.error('OCR 服务未启动，请手动填写或启动 OCR 微服务（pnpm dev:ocr）');
      } else if (msg.includes('未识别到文字') || msg.includes('OCR_EMPTY')) {
        toast.error('未识别到文字：请确认图片清晰、完整且为证件/证书照');
      } else if (msg.includes('识别失败') || msg.includes('OCR_FAILED')) {
        toast.error('识别失败：图片模糊或格式不支持，请更换图片或手动填写');
      } else {
        toast.error(msg || '识别失败，请手动填写');
      }
    }
    setOcrLoading(false);
    e.target.value = '';
  };

  if (!open) return null;

  const inputCls = (field: keyof FormFields) => `neu-input w-full text-sm ${errors[field] ? '!border-[var(--danger)]' : ''}`;
  const FieldError = ({ field }: { field: keyof FormFields }) => errors[field] ? <p className="text-xs font-medium text-[var(--danger)] mt-0.5">{errors[field]}</p> : null;
  const Step = ({ n }: { n: number }) => <span className="flex h-[18px] w-[18px] items-center justify-center rounded-md text-[10px] font-extrabold bg-[var(--accent)] text-white">{n}</span>;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="录入专家"
      description="录入评审专家基础资料、专业方向和可用状态，录入后专家即可参与项目评审抽取"
      footer={
        <div className="flex items-center justify-between gap-3 w-full">
          <p className="text-xs text-[var(--muted-foreground)]"><span className="text-[var(--danger)]">*</span> 为必填项</p>
          <div className="flex gap-3">
            <button onClick={onClose} className="neu-btn-soft">取消</button>
            <button onClick={submit} disabled={saving} className="neu-btn-soft is-info">
              {saving ? '保存中...' : <><UserPlus size={14} />录入专家</>}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {serverError && (
          <div className="rounded-xl bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-4 py-3 text-sm font-semibold text-[var(--danger)] shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">{serverError}</div>
        )}

        {/* AI 资质 OCR 自动录入 */}
        <label className="neu-drop-zone">
          {ocrLoading ? <RefreshCw size={16} className="animate-spin text-[var(--muted-foreground)] mb-1" /> : <ScanLine size={16} className="text-[var(--muted-foreground)] mb-1" />}
          <span className="text-[0.75rem] font-medium text-[var(--muted-foreground)]">{ocrLoading ? '正在识别证件…' : '上传证件/证书照片或 PDF，AI 识别自动填充'}</span>
          <span className="mt-0.5 text-[0.65rem] text-[var(--muted-foreground)]/60">支持 JPG/PNG/PDF · 自动识别姓名、专业、职称、身份证、手机号等</span>
          <input type="file" accept="image/*,.pdf" className="hidden" onChange={handleOcr} disabled={ocrLoading} />
        </label>

        {/* CSV 导入 + 模板下载 */}
        <ExpertCsvActions onImported={onSubmitted} />

        {/* ① 登录凭证 */}
        <fieldset>
          <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]"><Step n={1} />登录凭证</legend>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">登录账号 <span className="text-[var(--danger)]">*</span></span><input value={form.username} onChange={e => set('username', e.target.value)} placeholder="如 expert_zhang（建议使用姓名拼音）" className={inputCls('username')} /><FieldError field="username" /></label>
            <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">专家姓名 <span className="text-[var(--danger)]">*</span></span><input value={form.displayName} onChange={e => set('displayName', e.target.value)} placeholder="真实姓名" className={inputCls('displayName')} /><FieldError field="displayName" /></label>
            <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">初始密码 <span className="text-[var(--danger)]">*</span></span><div className="relative"><input value={form.password} onChange={e => set('password', e.target.value)} type={showPw ? 'text' : 'password'} placeholder="至少 6 位" className={inputCls('password')} /><button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] hover:text-[var(--foreground)]">{showPw ? <EyeOff size={15} /> : <Eye size={15} />}</button></div><FieldError field="password" /></label>
          </div>
        </fieldset>
        <hr className="wb-section-rule" />

        {/* ② 专业资质 */}
        <fieldset>
          <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]"><Step n={2} />专业资质</legend>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">专业领域 <span className="text-[var(--danger)]">*</span></span><input value={form.specialty} onChange={e => set('specialty', e.target.value)} list="entry-spec-list" placeholder="如 水利工程" className={inputCls('specialty')} /><datalist id="entry-spec-list">{specialties.map(s => <option key={s} value={s} />)}</datalist><FieldError field="specialty" /></label>
            <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">职称</span><input value={form.title} onChange={e => set('title', e.target.value)} list="entry-title-list" placeholder="如 高级工程师" className={inputCls('title')} /><datalist id="entry-title-list">{TITLES.map(t => <option key={t} value={t} />)}</datalist></label>
            <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">工作单位</span><input value={form.employer} onChange={e => set('employer', e.target.value)} placeholder="所在单位全称" className={inputCls('employer')} /></label>
            <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">所属部门</span><input value={form.departmentName} onChange={e => set('departmentName', e.target.value)} placeholder="如 工程勘察院" className={inputCls('departmentName')} /></label>
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

        {/* ④ 档案信息（选填，默认折叠）*/}
        <details className="group">
          <summary className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)] cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <Step n={4} />档案信息（选填）<span className="text-[var(--muted-foreground)]/60 font-normal normal-case tracking-normal">— 民族 / 学历 / 执业资格证号</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-auto text-[var(--muted-foreground)] transition-transform group-open:rotate-180"><path d="M6 9l6 6 6-6"/></svg>
          </summary>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">民族</span><input value={form.ethnicity} onChange={e => set('ethnicity', e.target.value)} list="entry-ethnicity-list" placeholder="如 汉族" className={inputCls('ethnicity')} /><datalist id="entry-ethnicity-list">{ETHNICITIES.map(t => <option key={t} value={t} />)}</datalist></label>
            <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">学历</span><input value={form.education} onChange={e => set('education', e.target.value)} list="entry-edu-list" placeholder="如 硕士" className={inputCls('education')} /><datalist id="entry-edu-list">{EDUCATIONS.map(t => <option key={t} value={t} />)}</datalist></label>
            <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">执业资格证号</span><input value={form.licenseNo} onChange={e => set('licenseNo', e.target.value)} placeholder="执业资格证号" className={inputCls('licenseNo') + ' font-mono'} /></label>
          </div>
        </details>
        <hr className="wb-section-rule" />

        {/* ⑤ 补充信息 */}
        <fieldset>
          <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]"><Step n={5} />补充信息</legend>
          <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">备注</span><textarea value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="补充说明、特殊资质说明、回避事项等" rows={3} className={inputCls('notes') + ' resize-y'} /></label>
        </fieldset>
      </div>
    </Modal>
  );
}
