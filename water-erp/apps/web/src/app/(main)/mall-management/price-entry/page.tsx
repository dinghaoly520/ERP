'use client';

import { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { useFormAutosave, useUnsavedGuard } from '@/lib/hooks/use-form-autosave';
import { PenLine, Upload, Download, FileSpreadsheet } from 'lucide-react';
import {
  createCatalogItem, downloadImportTemplate, importCatalogFile, setItemAttributes,
  type CatalogItemInput, type ImportResult,
} from '@/lib/api/catalog-admin';
import { CategoryTreeSelect } from '@/components/catalog/CategoryTreeSelect';
import { AttributeValueEditor } from '@/components/catalog/AttributeValueEditor';
import { buildDynamicFields, extractAttributeValues, type DynamicField } from '@/lib/attribute-template-utils';
import type { CategoryNode } from '@/lib/category-tree-utils';

type FormFields = CatalogItemInput;
const INITIAL: FormFields = {
  code: '', name: '', specification: '', category: '', group: '', unit: '',
  referencePrice: 0, priceMin: 0, priceMax: 0, lastDealPrice: 0, averagePrice: 0,
  supplier: '', supplierType: '协议供应商', priceSource: '人工维护', region: '全省',
  taxIncluded: true, freightIncluded: false, changeRate: 0, minOrder: '',
  remark: null, status: '有效', validUntil: null,
};

export default function PriceEntryPage() {
  const [form, setForm] = useState<FormFields>(INITIAL);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [serverError, setServerError] = useState('');
  const [errors, setErrors] = useState<Partial<Record<keyof FormFields, string>>>({});
  const [dynamicFields, setDynamicFields] = useState<DynamicField[]>([]);
  const hasChanges = Object.entries(form).some(([k, v]) => v !== (INITIAL as any)[k]);
  const { getDraft, clearDraft } = useFormAutosave('price-entry', form as unknown as Record<string, unknown>);
  useUnsavedGuard(hasChanges);
  const [draftRestored, setDraftRestored] = useState(false);
  useEffect(() => {
    if (draftRestored) return;
    const draft = getDraft();
    if (draft && draft.code) {
      if (confirm('检测到未提交的表单草稿（保存于 ' + new Date(draft._savedAt).toLocaleTimeString('zh-CN') + '），是否恢复？')) { setForm({ ...INITIAL, ...draft as unknown as FormFields }); }
    }
    setDraftRestored(true);
  }, [getDraft, draftRestored]);
  const fileRef = useRef<HTMLInputElement>(null);

  const setField = (key: keyof FormFields, value: string | number | boolean | null) => {
    setForm(prev => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
    if (serverError) setServerError('');
  };

  const handleCategoryChange = (categoryId: number | null, node?: CategoryNode) => {
    setField('categoryId' as any, categoryId);
    if (node?.attributeTemplates && node.attributeTemplates.length > 0) {
      setDynamicFields(buildDynamicFields(node.attributeTemplates as any));
    } else {
      setDynamicFields([]);
    }
  };

  const validate = (): boolean => {
    const e: Partial<Record<keyof FormFields, string>> = {};
    if (!form.code.trim()) e.code = '请输入目录编码';
    if (!form.name.trim()) e.name = '请输入商品名称';
    if (form.referencePrice < 0) e.referencePrice = '参考价不能为负';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    setServerError(''); if (!validate()) return;
    setSaving(true);
    try {
      const created = await createCatalogItem(form);
      if (dynamicFields.length > 0) {
        const attrs = extractAttributeValues(dynamicFields);
        if (attrs.length > 0) await setItemAttributes(created.id, attrs);
      }
      toast.success('目录已新增'); clearDraft(); setForm(INITIAL); setDynamicFields([]);
    }
    catch (err: any) { setServerError(err.message || '新增失败'); }
    finally { setSaving(false); }
  };

  const downloadTemplate = async () => {
    try { const blob = await downloadImportTemplate(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '电子商城目录导入模板.xlsx'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); toast.success('模板下载中...'); }
    catch (err: any) { toast.error(err.message || '模板下载失败'); }
  };

  const upload = async () => {
    if (!file) { toast.error('请选择文件'); return; }
    setImporting(true);
    try {
      const res = await importCatalogFile(file); setResult(res);
      if (res.failed > 0) { toast.error(`${res.failed} 行导入失败`); } else { toast.success(`导入成功：新增 ${res.created}，更新 ${res.updated}`); }
    } catch (err: any) { toast.error(err.message || '导入失败'); }
    setImporting(false);
  };

  const inputClass = (field: keyof FormFields) => `neu-input w-full text-sm ${errors[field] ? '!border-[var(--danger)]' : ''}`;
  const FieldError = ({ field }: { field: keyof FormFields }) => errors[field] ? <p className="text-xs font-medium text-[var(--danger)] mt-0.5">{errors[field]}</p> : null;
  const numField = (field: keyof FormFields, label: string, placeholder?: string) => (
    <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">{label}</span><input type="number" value={form[field] as number} onChange={e => setField(field, Number(e.target.value))} placeholder={placeholder} className={inputClass(field)} /><FieldError field={field} /></label>
  );
  const txtField = (field: keyof FormFields, label: string, placeholder?: string, required?: boolean) => (
    <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">{label}{required && <span className="text-[var(--danger)] ml-0.5">*</span>}</span><input value={String(form[field] ?? '')} onChange={e => setField(field, e.target.value)} placeholder={placeholder} className={inputClass(field)} /><FieldError field={field} /></label>
  );

  const StepNumber = ({ n, active }: { n: number; active: boolean }) => (
    <span className={`flex h-[18px] w-[18px] items-center justify-center rounded-md text-[10px] font-extrabold ${active ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface)] text-[var(--muted-foreground)] shadow-[inset_1px_1px_2px_oklch(0.55_0.03_258/0.06)]'}`}>{n}</span>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><PenLine size={17} /></div>
            <div>
              <div className="page-hero__title">价格录入</div>
              <div className="page-hero__sub">支持手动新增目录和 CSV/Excel 批量导入，目录编码存在则更新，不存在则新增</div>
            </div>
          </div>
        </div>
      </div>

      {serverError && (
        <div className="flex items-start gap-2.5 rounded-xl bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-4 py-3 text-sm font-semibold text-[var(--danger)] shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">
          <span>{serverError}</span>
        </div>
      )}

      {/* ══════ 批量导入 ══════ */}
      <div className="neu-table-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Upload size={15} className="text-[var(--accent)]" />
            <span className="text-sm font-bold text-[var(--foreground)]">批量导入</span>
            <span className="text-xs text-[var(--muted-foreground)]">.xlsx / .xls / .csv</span>
          </div>
          <button onClick={downloadTemplate} className="neu-btn-soft"><Download size={13} />下载模板</button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={e => setFile(e.target.files?.[0] || null)} className="neu-input text-sm flex-1 min-w-[200px] max-w-md" />
          <button onClick={upload} disabled={importing || !file} className="neu-btn-soft">{importing ? '导入中...' : <><FileSpreadsheet size={14} />开始导入</>}</button>
        </div>
        {result && (
          <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "0.75rem", marginTop: "0.75rem" }}>
            <div className="flex items-center gap-3 mb-3"><span className="text-sm font-bold text-[var(--foreground)]">导入结果</span><span className="text-xs text-[var(--muted-foreground)]">共 {result.totalRows} 行</span></div>
            <div className="grid grid-cols-4 gap-0">
              <div className="text-center"><span className="text-lg font-extrabold tabular-nums text-[var(--success)]">{result.created}</span><span className="block text-xs text-[var(--muted-foreground)]">新增</span></div>
              <div className="text-center"><span className="text-lg font-extrabold tabular-nums text-[var(--accent)]">{result.updated}</span><span className="block text-xs text-[var(--muted-foreground)]">更新</span></div>
              <div className="text-center"><span className="text-lg font-extrabold tabular-nums text-[var(--danger)]">{result.failed}</span><span className="block text-xs text-[var(--muted-foreground)]">失败</span></div>
              <div className="text-center"><span className="text-lg font-extrabold tabular-nums">{result.created + result.updated}</span><span className="block text-xs text-[var(--muted-foreground)]">成功</span></div>
            </div>
            {result.failedRows.length > 0 && <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "0.75rem", marginTop: "0.75rem" }}><p className="text-xs font-semibold text-[var(--danger)] mb-2">失败明细</p>{result.failedRows.map(row => (<div key={row.rowNumber} className="rounded-lg bg-[color-mix(in_oklch,var(--danger)_6%,transparent)] px-2.5 py-1.5 text-xs text-[var(--foreground)]"><span className="font-medium tabular-nums">第 {row.rowNumber} 行</span>{row.code && <span className="text-[var(--muted-foreground)] ml-2 font-mono text-[11px]">{row.code}</span>}<span className="ml-2">— {row.errors.join('；')}</span></div>))}</div>}
          </div>
        )}
      </div>

      {/* ══════ 手动新增目录 ══════ */}
      <div className="neu-table-card p-5 space-y-6">
        {/* ① 商品信息 */}
        <fieldset>
          <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]"><StepNumber n={1} active />商品信息</legend>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {txtField('code', '目录编码', '唯一编码，如 CG-2025-001', true)}
            {txtField('name', '商品名称', '商品通用名称', true)}
            {txtField('specification', '规格型号', '如 500ml×24瓶')}
            {txtField('unit', '单位', '如 个、箱、件')}
          </div>
          <div className="mt-4 max-w-xs">
            <label className="text-xs font-semibold text-[var(--muted-foreground)] mb-1 block">品类 <span className="text-red-400">*</span></label>
            <CategoryTreeSelect value={form.categoryId as number | null} onChange={handleCategoryChange} placeholder="选择品类" />
          </div>
        </fieldset>

        {dynamicFields.length > 0 && <AttributeValueEditor fields={dynamicFields} onChange={setDynamicFields} />}

        <hr className="wb-section-rule" />

        {/* ② 价格体系 */}
        <fieldset>
          <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]"><StepNumber n={2} active />价格体系</legend>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {numField('referencePrice', '参考价（元）', '市场价格参考')}
            {numField('priceMin', '价格下限（元）', '最低可接受价')}
            {numField('priceMax', '价格上限（元）', '最高限价')}
            {numField('lastDealPrice', '最近成交价（元）')}
            {numField('averagePrice', '历史均价（元）')}
            {numField('changeRate', '价格变化率（%）')}
          </div>
        </fieldset>

        <hr className="wb-section-rule" />

        {/* ③ 采购来源 */}
        <fieldset>
          <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]"><StepNumber n={3} active />采购来源</legend>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {txtField('supplier', '供应商', '供应商企业名称')}
            <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">供应商类型</span><select value={form.supplierType} onChange={e => setField('supplierType', e.target.value)} className={inputClass('supplierType')}><option value="协议供应商">协议供应商</option><option value="定点供应商">定点供应商</option><option value="临时供应商">临时供应商</option></select></label>
            <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">价格来源</span><select value={form.priceSource} onChange={e => setField('priceSource', e.target.value)} className={inputClass('priceSource')}><option value="人工维护">人工维护</option><option value="历史成交">历史成交</option><option value="市场询价">市场询价</option><option value="系统采集">系统采集</option></select></label>
            <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">区域</span><select value={form.region} onChange={e => setField('region', e.target.value)} className={inputClass('region')}><option value="全省">全省</option><option value="成都">成都</option><option value="绵阳">绵阳</option><option value="德阳">德阳</option><option value="宜宾">宜宾</option><option value="南充">南充</option><option value="泸州">泸州</option><option value="其他">其他</option></select></label>
            {txtField('minOrder', '最小起订量', '如 ≥10件')}
            {txtField('validUntil', '有效期', 'YYYY-MM-DD')}
          </div>
        </fieldset>

        <hr className="wb-section-rule" />

        {/* ④ 补充信息 */}
        <fieldset>
          <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]"><StepNumber n={4} active={false} />补充信息</legend>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">状态</span><select value={form.status} onChange={e => setField('status', e.target.value)} className={inputClass('status')}><option value="有效">有效</option><option value="价格波动">价格波动</option><option value="待复核">待复核</option><option value="下架">下架</option><option value="停用">停用</option></select></label>
            <div className="flex items-end gap-6 pb-2">
              <label className="flex items-center gap-2 text-sm text-[var(--muted-foreground)] cursor-pointer"><input type="checkbox" checked={form.taxIncluded} onChange={e => setField('taxIncluded', e.target.checked)} className="neu-checkbox" />含税</label>
              <label className="flex items-center gap-2 text-sm text-[var(--muted-foreground)] cursor-pointer"><input type="checkbox" checked={form.freightIncluded} onChange={e => setField('freightIncluded', e.target.checked)} className="neu-checkbox" />含运费</label>
            </div>
          </div>
          <label className="mt-4 block space-y-1"><span className="text-xs font-semibold text-[var(--muted-foreground)]">备注</span><textarea value={form.remark || ''} onChange={e => setField('remark', e.target.value || null)} placeholder="补充说明、采购要求、特殊条款等" rows={3} className={inputClass('remark') + ' resize-y'} /></label>
        </fieldset>

        <div className="flex items-center justify-between gap-3 pt-4" style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)" }}>
          <p className="text-xs text-[var(--muted-foreground)]"><span className="text-[var(--danger)]">*</span> 为必填项</p>
          <button disabled={saving} onClick={submit} className="neu-btn-soft">{saving ? '保存中...' : <><PenLine size={14} />新增目录</>}</button>
        </div>
      </div>
    </div>
  );
}
