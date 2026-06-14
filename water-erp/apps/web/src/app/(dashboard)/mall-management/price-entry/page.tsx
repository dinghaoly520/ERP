'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  createCatalogItem,
  downloadImportTemplate,
  importCatalogFile,
  type CatalogItemInput,
  type ImportResult,
} from '@/lib/api/catalog-admin';

const emptyForm: CatalogItemInput = {
  code: '', name: '', specification: '', category: '', group: '', unit: '',
  referencePrice: 0, priceMin: 0, priceMax: 0, lastDealPrice: 0, averagePrice: 0,
  supplier: '', supplierType: '协议供应商', priceSource: '人工维护', region: '全省',
  taxIncluded: true, freightIncluded: false, changeRate: 0, minOrder: '',
  remark: null, status: '有效', validUntil: null,
};

export default function PriceEntryPage() {
  const [form, setForm] = useState<CatalogItemInput>(emptyForm);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [saving, setSaving] = useState(false);

  const setField = (key: keyof CatalogItemInput, value: string | number | boolean | null) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const submit = async () => {
    setSaving(true);
    try {
      await createCatalogItem(form);
      toast.success('目录已新增');
      setForm(emptyForm);
    } catch (err: any) {
      toast.error(err.message || '新增失败');
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
    } catch (err: any) { toast.error(err.message || '模板下载失败'); }
  };

  const upload = async () => {
    if (!file) { toast.error('请选择文件'); return; }
    try {
      const res = await importCatalogFile(file);
      setResult(res);
      toast.success(res.failed ? '导入部分成功' : '导入成功');
    } catch (err: any) { toast.error(err.message || '导入失败'); }
  };

  const num = (key: keyof CatalogItemInput, label: string) => (
    <label className="space-y-1 text-sm font-semibold text-[#5a6d8a]">
      <span>{label}</span>
      <input type="number" value={Number(form[key] || 0)} onChange={e => setField(key, Number(e.target.value))} className="w-full rounded-xl border border-[#d5e0ef] px-3 py-2" />
    </label>
  );
  const txt = (key: keyof CatalogItemInput, label: string) => (
    <label className="space-y-1 text-sm font-semibold text-[#5a6d8a]">
      <span>{label}</span>
      <input value={String(form[key] ?? '')} onChange={e => setField(key, e.target.value)} className="w-full rounded-xl border border-[#d5e0ef] px-3 py-2" />
    </label>
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold text-[#064ea2]">电子商城管理</p>
        <h1 className="mt-1 text-2xl font-black text-[#18243a]">价格录入</h1>
        <p className="mt-2 text-sm text-[#5a6d8a]">支持手动新增目录和 CSV/Excel 批量导入。导入时目录编码存在则更新，不存在则新增。</p>
      </div>

      <div className="rounded-2xl border border-[#dce6f3] bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-[#18243a]">批量导入</h2>
          <button onClick={downloadTemplate} className="rounded-xl border border-[#064ea2] px-4 py-2 text-sm font-bold text-[#064ea2]">下载模板</button>
        </div>
        <div className="flex flex-wrap gap-3">
          <input type="file" accept=".xlsx,.xls,.csv" onChange={e => setFile(e.target.files?.[0] || null)} className="rounded-xl border border-[#d5e0ef] px-3 py-2 text-sm" />
          <button onClick={upload} className="rounded-xl bg-[#064ea2] px-4 py-2 text-sm font-bold text-white">开始导入</button>
        </div>
        {result && (
          <div className="mt-4 rounded-xl bg-[#f3f7fc] p-4 text-sm text-[#18243a]">
            <div className="font-bold">总行数 {result.totalRows}，新增 {result.created}，更新 {result.updated}，失败 {result.failed}</div>
            {result.failedRows.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-orange-700">
                {result.failedRows.map(row => (
                  <li key={row.rowNumber}>第 {row.rowNumber} 行（{row.code || '无编码'}）：{row.errors.join('；')}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[#dce6f3] bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-black text-[#18243a]">手动新增目录</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {txt('code', '目录编码')}{txt('name', '名称')}{txt('specification', '规格型号')}
          {txt('category', '分类')}{txt('group', '分组')}{txt('unit', '单位')}
          {num('referencePrice', '参考价')}{num('priceMin', '价格下限')}{num('priceMax', '价格上限')}
          {num('lastDealPrice', '最近成交价')}{num('averagePrice', '历史均价')}{num('changeRate', '价格变化率')}
          {txt('supplier', '供应商')}{txt('supplierType', '供应商类型')}{txt('priceSource', '价格来源')}
          {txt('region', '区域')}{txt('minOrder', '最小起订量')}{txt('validUntil', '有效期 YYYY-MM-DD')}
        </div>
        <label className="mt-4 block space-y-1 text-sm font-semibold text-[#5a6d8a]">
          <span>备注</span>
          <textarea value={form.remark || ''} onChange={e => setField('remark', e.target.value || null)} className="w-full rounded-xl border border-[#d5e0ef] px-3 py-2" rows={3} />
        </label>
        <button disabled={saving} onClick={submit} className="mt-5 rounded-xl bg-[#064ea2] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60">
          {saving ? '保存中...' : '新增目录'}
        </button>
      </div>
    </div>
  );
}
