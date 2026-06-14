'use client';

import { useState, useRef } from 'react';
import { toast } from 'sonner';
import { PageHero, SectionCard } from '@/components/workbench';
import { PenLine, Upload, Download, FileSpreadsheet } from 'lucide-react';
import {
  createCatalogItem,
  downloadImportTemplate,
  importCatalogFile,
  type CatalogItemInput,
  type ImportResult,
} from '@/lib/api/catalog-admin';

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
  const fileRef = useRef<HTMLInputElement>(null);

  const setField = (key: keyof FormFields, value: string | number | boolean | null) => {
    setForm(prev => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
    if (serverError) setServerError('');
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
    setServerError('');
    if (!validate()) return;
    setSaving(true);
    try {
      await createCatalogItem(form);
      toast.success('目录已新增');
      setForm(INITIAL);
    } catch (err: any) {
      setServerError(err.message || '新增失败');
    } finally { setSaving(false); }
  };

  const downloadTemplate = async () => {
    try {
      const blob = await downloadImportTemplate();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '电子商城目录导入模板.xlsx';
      document.body.appendChild(a);
      a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success('模板下载中...');
    } catch (err: any) { toast.error(err.message || '模板下载失败'); }
  };

  const upload = async () => {
    if (!file) { toast.error('请选择文件'); return; }
    setImporting(true);
    try {
      const res = await importCatalogFile(file);
      setResult(res);
      if (res.failed > 0) {
        toast.error(`${res.failed} 行导入失败`);
      } else {
        toast.success(`导入成功：新增 ${res.created}，更新 ${res.updated}`);
      }
    } catch (err: any) { toast.error(err.message || '导入失败'); }
    setImporting(false);
  };

  /* ── 渲染辅助 ── */

  const inputClass = (field: keyof FormFields) =>
    `workbench-input w-full text-sm ${errors[field] ? 'border-red-300 focus:border-red-400' : ''}`;

  const FieldError = ({ field }: { field: keyof FormFields }) =>
    errors[field] ? <p className="text-xs font-medium text-red-600 mt-0.5">{errors[field]}</p> : null;

  const numField = (field: keyof FormFields, label: string, placeholder?: string) => (
    <label className="space-y-1">
      <span className="text-sm font-semibold text-[#5a6d8a]">{label}</span>
      <input
        type="number"
        value={form[field] as number}
        onChange={e => setField(field, Number(e.target.value))}
        placeholder={placeholder}
        className={inputClass(field)}
      />
      <FieldError field={field} />
    </label>
  );

  const txtField = (field: keyof FormFields, label: string, placeholder?: string, required?: boolean) => (
    <label className="space-y-1">
      <span className="text-sm font-semibold text-[#5a6d8a]">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      <input
        value={String(form[field] ?? '')}
        onChange={e => setField(field, e.target.value)}
        placeholder={placeholder}
        className={inputClass(field)}
      />
      <FieldError field={field} />
    </label>
  );

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="电子商城管理"
        title="价格录入"
        description="支持手动新增目录和 CSV/Excel 批量导入。导入时目录编码存在则更新，不存在则新增。"
        tone="blue"
        icon={<PenLine size={14} />}
      />

      {serverError && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          <span className="mt-px shrink-0 rounded-full bg-red-200 w-4 h-4 flex items-center justify-center text-[10px] font-extrabold text-red-700">!</span>
          <span>{serverError}</span>
        </div>
      )}

      {/* ── 批量导入 ── */}
      <SectionCard
        title="批量导入"
        description="支持 .xlsx / .xls / .csv 格式，按目录编码匹配合并"
        icon={<Upload size={15} />}
        action={
          <button onClick={downloadTemplate}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[#064ea2] px-3 py-1.5 text-xs font-bold text-[#064ea2] hover:bg-[#f0f5ff] transition">
            <Download size={13} />下载模板
          </button>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={e => setFile(e.target.files?.[0] || null)}
            className="workbench-input text-sm flex-1 min-w-[200px] max-w-md"
          />
          <button
            onClick={upload}
            disabled={importing || !file}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#064ea2] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#054280] disabled:opacity-50 transition"
          >
            {importing ? '导入中...' : <><FileSpreadsheet size={14} />开始导入</>}
          </button>
        </div>

        {result && (
          <div className="mt-4 rounded-xl border border-[#dce6f3] bg-[#f8fbff]">
            <div className="flex items-center gap-3 p-4 border-b border-[#edf2f7]">
              <span className="text-sm font-bold text-[#18243a]">导入结果</span>
              <span className="text-xs text-[#8a99ad]">共 {result.totalRows} 行</span>
            </div>
            <div className="grid grid-cols-4 gap-0 px-4 py-3">
              <div className="text-center">
                <div className="text-lg font-extrabold tabular-nums text-[#11a874]">{result.created}</div>
                <div className="text-xs text-[#8a99ad]">新增</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-extrabold tabular-nums text-[#064ea2]">{result.updated}</div>
                <div className="text-xs text-[#8a99ad]">更新</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-extrabold tabular-nums text-red-500">{result.failed}</div>
                <div className="text-xs text-[#8a99ad]">失败</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-extrabold tabular-nums text-[#5a6d8a]">{result.created + result.updated}</div>
                <div className="text-xs text-[#8a99ad]">成功合计</div>
              </div>
            </div>
            {result.failedRows.length > 0 && (
              <div className="border-t border-[#edf2f7] px-4 py-3 max-h-[200px] overflow-y-auto">
                <p className="text-xs font-semibold text-red-600 mb-2">失败明细</p>
                <div className="space-y-1.5">
                  {result.failedRows.map(row => (
                    <div key={row.rowNumber} className="text-xs text-red-700 bg-red-50 rounded-lg px-2.5 py-1.5">
                      <span className="font-medium tabular-nums">第 {row.rowNumber} 行</span>
                      {row.code && <span className="text-[#8a99ad] ml-2 font-mono text-[11px]">{row.code}</span>}
                      <span className="ml-2">— {row.errors.join('；')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {/* ── 手动新增目录 ── */}
      <SectionCard title="手动新增目录">
        <div className="space-y-6">
          {/* ──────────── ① 商品信息 ──────────── */}
          <fieldset>
            <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.15em] text-[#94a3b8]">
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-md bg-[#064ea2] text-[10px] font-extrabold text-white">1</span>
              商品信息
            </legend>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {txtField('code', '目录编码', '唯一编码，如 CG-2025-001', true)}
              {txtField('name', '商品名称', '商品通用名称', true)}
              {txtField('specification', '规格型号', '如 500ml×24瓶')}
              {txtField('category', '分类', '如 办公用品')}
              {txtField('group', '分组', '如 文具耗材')}
              {txtField('unit', '单位', '如 个、箱、件')}
            </div>
          </fieldset>

          <div className="border-t border-[#edf2f7]" />

          {/* ──────────── ② 价格体系 ──────────── */}
          <fieldset>
            <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.15em] text-[#94a3b8]">
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-md bg-[#064ea2] text-[10px] font-extrabold text-white">2</span>
              价格体系
            </legend>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {numField('referencePrice', '参考价（元）', '市场价格参考')}
              {numField('priceMin', '价格下限（元）', '最低可接受价')}
              {numField('priceMax', '价格上限（元）', '最高限价')}
              {numField('lastDealPrice', '最近成交价（元）')}
              {numField('averagePrice', '历史均价（元）')}
              {numField('changeRate', '价格变化率（%）')}
            </div>
          </fieldset>

          <div className="border-t border-[#edf2f7]" />

          {/* ──────────── ③ 采购来源 ──────────── */}
          <fieldset>
            <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.15em] text-[#94a3b8]">
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-md border border-[#dce3eb] bg-[#f8fafc] text-[10px] font-extrabold text-[#5a6d8a]">3</span>
              采购来源
            </legend>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {txtField('supplier', '供应商', '供应商企业名称')}
              <label className="space-y-1">
                <span className="text-sm font-semibold text-[#5a6d8a]">供应商类型</span>
                <select value={form.supplierType} onChange={e => setField('supplierType', e.target.value)} className={inputClass('supplierType')}>
                  <option value="协议供应商">协议供应商</option>
                  <option value="定点供应商">定点供应商</option>
                  <option value="临时供应商">临时供应商</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-sm font-semibold text-[#5a6d8a]">价格来源</span>
                <select value={form.priceSource} onChange={e => setField('priceSource', e.target.value)} className={inputClass('priceSource')}>
                  <option value="人工维护">人工维护</option>
                  <option value="历史成交">历史成交</option>
                  <option value="市场询价">市场询价</option>
                  <option value="系统采集">系统采集</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-sm font-semibold text-[#5a6d8a]">区域</span>
                <select value={form.region} onChange={e => setField('region', e.target.value)} className={inputClass('region')}>
                  <option value="全省">全省</option>
                  <option value="成都">成都</option>
                  <option value="绵阳">绵阳</option>
                  <option value="德阳">德阳</option>
                  <option value="宜宾">宜宾</option>
                  <option value="南充">南充</option>
                  <option value="泸州">泸州</option>
                  <option value="其他">其他</option>
                </select>
              </label>
              {txtField('minOrder', '最小起订量', '如 ≥10件')}
              {txtField('validUntil', '有效期', 'YYYY-MM-DD')}
            </div>
          </fieldset>

          <div className="border-t border-[#edf2f7]" />

          {/* ──────────── ④ 补充信息 ──────────── */}
          <fieldset>
            <legend className="flex items-center gap-2 mb-3 text-xs font-bold uppercase tracking-[0.15em] text-[#94a3b8]">
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-md border border-[#dce3eb] bg-[#f8fafc] text-[10px] font-extrabold text-[#5a6d8a]">4</span>
              补充信息
            </legend>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <label className="space-y-1">
                <span className="text-sm font-semibold text-[#5a6d8a]">状态</span>
                <select value={form.status} onChange={e => setField('status', e.target.value)} className={inputClass('status')}>
                  <option value="有效">有效</option>
                  <option value="价格波动">价格波动</option>
                  <option value="待复核">待复核</option>
                  <option value="下架">下架</option>
                  <option value="停用">停用</option>
                </select>
              </label>
              <div className="flex items-end gap-6 pb-2">
                <label className="flex items-center gap-2 text-sm font-semibold text-[#5a6d8a] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.taxIncluded}
                    onChange={e => setField('taxIncluded', e.target.checked)}
                    className="rounded border-[#dce6f3] text-[#064ea2] focus:ring-[#064ea2]/20 h-4 w-4"
                  />
                  含税
                </label>
                <label className="flex items-center gap-2 text-sm font-semibold text-[#5a6d8a] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.freightIncluded}
                    onChange={e => setField('freightIncluded', e.target.checked)}
                    className="rounded border-[#dce6f3] text-[#064ea2] focus:ring-[#064ea2]/20 h-4 w-4"
                  />
                  含运费
                </label>
              </div>
            </div>
            <label className="mt-4 block space-y-1">
              <span className="text-sm font-semibold text-[#5a6d8a]">备注</span>
              <textarea
                value={form.remark || ''}
                onChange={e => setField('remark', e.target.value || null)}
                placeholder="补充说明、采购要求、特殊条款等"
                rows={3}
                className={`${inputClass('remark')} resize-y`}
              />
            </label>
          </fieldset>

          {/* ──────────── 操作 ──────────── */}
          <div className="flex items-center justify-between gap-3 border-t border-[#edf2f7] pt-5">
            <p className="text-xs text-[#94a3b8]">
              <span className="text-red-500">*</span> 为必填项，新增后可在目录管理页查看和编辑
            </p>
            <button
              disabled={saving}
              onClick={submit}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#064ea2] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#054280] disabled:opacity-50 transition"
            >
              {saving ? '保存中...' : <><PenLine size={14} />新增目录</>}
            </button>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
